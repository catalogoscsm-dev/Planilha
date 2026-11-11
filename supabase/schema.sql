-- ============================================================
--  schema.sql — PLANILHA (clone do Google Sheets, degradê azul)
--  Rode no SQL Editor do Supabase. Idempotente: pode rodar novamente.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
--  TABELA: planilhas
-- ============================================================
create table if not exists public.planilhas (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  titulo        text not null default 'Planilha sem título',
  dados         jsonb not null default '[]'::jsonb,
  versao        int  not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Para deployments já existentes (idempotente)
alter table public.planilhas add column if not exists versao int not null default 1;
-- owner_id recebe auth.uid() automaticamente no INSERT quando não informado
alter table public.planilhas alter column owner_id set default auth.uid();

create index if not exists planilhas_owner_idx on public.planilhas(owner_id);

-- ============================================================
--  TABELA: colaboradores
--  Convites por e-mail — acesso resolvido pelo JWT no login.
-- ============================================================
create table if not exists public.colaboradores (
  id           uuid primary key default gen_random_uuid(),
  planilha_id  uuid not null references public.planilhas(id) on delete cascade,
  email        text not null,
  permissao    text not null default 'editar' check (permissao in ('editar','ver')),
  criado_em    timestamptz not null default now()
);

create index if not exists colaboradores_email_idx    on public.colaboradores(lower(email));
create index if not exists colaboradores_planilha_idx on public.colaboradores(planilha_id);

-- Etapa 1a: unique por expressão — deve ser índice, não constraint inline
create unique index if not exists colaboradores_email_uniq
  on public.colaboradores(planilha_id, lower(email));

-- ============================================================
--  TABELA: admins
--  Inserção apenas via Table Editor/SQL no Supabase (sem RPC pública).
-- ============================================================
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins
  for select using (user_id = auth.uid());

-- ============================================================
--  TABELA: transferencias_log
--  Auditoria de transferências de ownership. Inserções via
--  SECURITY DEFINER (bypass RLS); leitura só para admins.
-- ============================================================
create table if not exists public.transferencias_log (
  id           uuid primary key default gen_random_uuid(),
  de_email     text not null,
  para_email   text not null,
  de_uid       uuid,
  para_uid     uuid,
  qtd          int  not null,
  operador_uid uuid,          -- null = service_role / SQL Editor
  criado_em    timestamptz not null default now()
);
alter table public.transferencias_log enable row level security;
drop policy if exists tlog_select on public.transferencias_log;
create policy tlog_select on public.transferencias_log
  for select using (
    exists (select 1 from public.admins where user_id = auth.uid())
  );

-- ============================================================
--  TRIGGER: atualizado_em + versao
--  versao só incrementa quando `dados` muda (Etapa 3, adj 1).
-- ============================================================
create or replace function public.tg_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  if new.dados is distinct from old.dados then
    new.versao = coalesce(old.versao, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists set_atualizado_em on public.planilhas;
create trigger set_atualizado_em
  before update on public.planilhas
  for each row execute function public.tg_atualizado_em();

-- ============================================================
--  FUNÇÕES AUXILIARES (SECURITY DEFINER)
-- ============================================================
create or replace function public.e_dono_planilha(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.planilhas p
    where p.id = pid and p.owner_id = auth.uid()
  );
$$;

create or replace function public.pode_ver_planilha(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
      select 1 from public.planilhas p
      where p.id = pid and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.colaboradores c
      where c.planilha_id = pid
        and lower(c.email) = lower(auth.jwt() ->> 'email')
    );
$$;

create or replace function public.pode_editar_planilha(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
      select 1 from public.planilhas p
      where p.id = pid and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.colaboradores c
      where c.planilha_id = pid
        and lower(c.email) = lower(auth.jwt() ->> 'email')
        and c.permissao = 'editar'
    );
$$;

-- ============================================================
--  FUNÇÃO: transferir_planilhas (Etapa 1b, adj 1 e 2)
--  Permite: auth.uid() nulo (service_role / SQL Editor) OU admin.
--  Grava auditoria em transferencias_log.
--  Revogada de public/anon — só service_role ou chamada interna.
-- ============================================================
create or replace function public.transferir_planilhas(de_email text, para_email text)
returns int language plpgsql security definer set search_path = public as $$
declare
  de_uid   uuid;
  para_uid uuid;
  n        int;
begin
  -- Permite: auth.uid() nulo (service_role/SQL Editor) OU admin autenticado
  if auth.uid() is not null and
     not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'Acesso negado: somente admins ou service_role podem transferir planilhas';
  end if;

  select id into de_uid   from auth.users where lower(email) = lower(de_email)   limit 1;
  select id into para_uid from auth.users where lower(email) = lower(para_email) limit 1;

  if de_uid   is null then raise exception 'Usuário de origem não encontrado: %',   de_email;   end if;
  if para_uid is null then raise exception 'Usuário de destino não encontrado: %', para_email; end if;
  if de_uid = para_uid then return 0; end if;

  -- Sinaliza ao trigger: transferência administrativa em curso
  perform set_config('planilha.admin_transfer', 'true', true);

  update public.planilhas set owner_id = para_uid where owner_id = de_uid;
  get diagnostics n = row_count;

  -- Auditoria (SECURITY DEFINER bypassa RLS em transferencias_log)
  insert into public.transferencias_log(de_email, para_email, de_uid, para_uid, qtd, operador_uid)
  values (lower(de_email), lower(para_email), de_uid, para_uid, n, auth.uid());

  return n;
end;
$$;

-- Nenhum role externo executa diretamente
revoke execute on function public.transferir_planilhas(text, text) from public;
revoke execute on function public.transferir_planilhas(text, text) from anon;

-- ============================================================
--  TRIGGER: proteger owner_id (Etapa 1b, adj 2)
--  Dupla validação: flag de sessão AND caller é admin ou service_role.
-- ============================================================
create or replace function public.tg_proteger_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id <> old.owner_id then
    -- Requer AMBAS: flag de sessão E caller autorizado
    if current_setting('planilha.admin_transfer', true) = 'true' and (
      auth.uid() is null or                                            -- service_role / SQL Editor
      exists (select 1 from public.admins where user_id = auth.uid()) -- admin autenticado
    ) then
      return new;  -- transferência administrativa autorizada
    end if;
    raise exception 'owner_id não pode ser alterado diretamente';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_owner on public.planilhas;
create trigger proteger_owner
  before update on public.planilhas
  for each row execute function public.tg_proteger_owner();

-- ============================================================
--  RLS
-- ============================================================
alter table public.planilhas    enable row level security;
alter table public.colaboradores enable row level security;

-- ---- planilhas ----
drop policy if exists planilhas_select on public.planilhas;
create policy planilhas_select on public.planilhas
  -- owner_id = auth.uid() garante que o dono veja a linha no INSERT…RETURNING,
  -- pois pode_ver_planilha() (SECURITY DEFINER) não enxerga a linha recém-criada.
  for select using (owner_id = auth.uid() or public.pode_ver_planilha(id));

drop policy if exists planilhas_insert on public.planilhas;
create policy planilhas_insert on public.planilhas
  for insert with check (owner_id = auth.uid());

drop policy if exists planilhas_update on public.planilhas;
create policy planilhas_update on public.planilhas
  for update using (public.pode_editar_planilha(id))
  with check (public.pode_editar_planilha(id));

drop policy if exists planilhas_delete on public.planilhas;
create policy planilhas_delete on public.planilhas
  for delete using (owner_id = auth.uid());

-- ---- colaboradores ----
drop policy if exists colaboradores_select on public.colaboradores;
create policy colaboradores_select on public.colaboradores
  for select using (
    public.e_dono_planilha(planilha_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists colaboradores_insert on public.colaboradores;
create policy colaboradores_insert on public.colaboradores
  for insert with check (public.e_dono_planilha(planilha_id));

drop policy if exists colaboradores_update on public.colaboradores;
create policy colaboradores_update on public.colaboradores
  for update using (public.e_dono_planilha(planilha_id))
  with check (public.e_dono_planilha(planilha_id));

drop policy if exists colaboradores_delete on public.colaboradores;
create policy colaboradores_delete on public.colaboradores
  for delete using (public.e_dono_planilha(planilha_id));

-- ============================================================
--  FIM
-- ============================================================
