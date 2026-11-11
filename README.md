# PLANILHA — clone do Google Sheets (degradê azul)

Planilha particular para você e seus colaboradores: fórmulas, formatação rica e gráficos,
salvas na nuvem (Supabase). Interface azul, altamente customizável.

- **Motor da planilha:** [Luckysheet](https://github.com/dream-num/Luckysheet) (MIT) via CDN.
- **Backend:** Supabase (login por e-mail/senha + banco Postgres com RLS).
- **Front-end:** HTML/CSS/JS puro, sem build. Módulos ES via CDN.

> Observação: o Luckysheet não tem idioma português nativo (só `en`, `es`, `zh`, `zh_tw`).
> A interface interna da planilha fica em espanhol (`es`, o mais próximo); toda a casca do app
> (login, painel, botões, mensagens) está em pt-BR.

---

## 1. Configurar o Supabase

1. Crie um projeto em <https://supabase.com>.
2. No **SQL Editor**, cole e rode todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
   Ele cria as tabelas `planilhas` e `colaboradores`, os gatilhos e as políticas de segurança (RLS).
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. (Opcional) Em **Authentication → Providers → Email**, você pode desativar
   "Confirm email" para testar mais rápido (sem precisar confirmar o e-mail).

## 2. Configurar o app

Edite [`js/config.js`](js/config.js) e preencha:

```js
supabaseUrl: 'https://SEU-PROJETO.supabase.co',
supabaseAnonKey: 'SUA-ANON-KEY-AQUI',
```

Tudo que é customizável está nesse arquivo (opções da planilha, idioma, auto-save) e em
[`css/theme.css`](css/theme.css) (paleta e degradês azuis).

## 3. Rodar localmente

Precisa ser servido por HTTP (os módulos ES não funcionam abrindo o arquivo direto).

```bash
# Python 3
python -m http.server 8000
# ou Node
npx serve .
```

Abra <http://localhost:8000>.

---

## Como usar

- **Entrar/Cadastrar:** crie uma conta na primeira tela.
- **Nova planilha:** botão "+" no painel.
- **Editar:** digite valores, fórmulas (`=SUM(A1:A3)`, `=IF(...)`, etc.), formate pela barra
  de ferramentas, insira **gráficos** pelo menu da toolbar. O salvamento é **automático**
  (e há botão "Salvar").
- **Compartilhar:** no painel (ícone 👥) ou dentro do editor, convide colaboradores por
  e-mail com permissão **editar** ou **ver**. Eles acessam com a própria conta.

## Segurança (RLS)

- Cada planilha só é visível para o **dono** e para os **colaboradores convidados** (por e-mail).
- Só o dono pode excluir, renomear pelo painel e gerenciar colaboradores.
- Colaboradores "ver" abrem em modo somente leitura.

## Estrutura

```
PLANILHA/
├─ index.html          Login/cadastro + painel de planilhas
├─ editor.html         Editor (Luckysheet em tela cheia)
├─ css/
│  ├─ theme.css        Paleta azul (customização central)
│  ├─ app.css          Layout (login, painel, topo do editor, modal)
│  └─ luckysheet-blue.css  Ajustes de cor da UI do Luckysheet
├─ js/
│  ├─ config.js        Chaves do Supabase e opções
│  ├─ supabaseClient.js
│  ├─ auth.js          Sessão (login/cadastro/logout/guarda)
│  ├─ dashboard.js     Login + painel
│  ├─ editor.js        Luckysheet + carregar/salvar
│  └─ sharing.js       Compartilhamento + toasts
└─ supabase/
   └─ schema.sql       Tabelas + RLS
```

## Customização rápida

- **Cores/degradê:** edite as variáveis em `css/theme.css` (`--azul-*`, `--grad-*`).
- **Tema escuro:** `localStorage.setItem('planilha-tema','dark')` (há paleta escura pronta).
- **Opções da planilha:** `js/config.js` → `CONFIG.planilha` (linhas/colunas padrão, mostrar
  barras, plugins, idioma, intervalo de auto-save).

## Notas / limitações

- Luckysheet está arquivado (sucessor: [Univer](https://github.com/dream-num/univer)), mas é
  estável e MIT. A versão está **fixada** (`2.1.13`) em `editor.html` e `js/config.js`.
- A borda da seleção de células é desenhada em canvas pelo Luckysheet e não é alterável por CSS.
- Colaboração é por **salvar/compartilhar** (não é edição simultânea ao vivo): recarregue para
  ver mudanças feitas por outra pessoa.
