/* ============================================================
   dashboard.js — login/cadastro + painel de planilhas
   ============================================================ */

import supabase from './supabaseClient.js';
import CONFIG from './config.js';
import { getSessao, login, cadastrar, logout, usuarioAtual } from './auth.js';
import { abrirCompartilhar, toast, seloModoLocal } from './sharing.js';

/* ---------- Elementos ---------- */
const viewCarregando = document.getElementById('view-carregando');
const viewAuth    = document.getElementById('view-auth');
const viewPainel  = document.getElementById('view-painel');

let modoCadastro = false;
let todasPlanilhas = [];
let usuario = null;

/* ============================================================
   Início: decide entre login e painel
   ============================================================ */
(async function init() {
  // Reage a login/logout em outra aba
  supabase.auth.onAuthStateChange((_evt, sessao) => {
    if (!sessao && !viewAuth.classList.contains('oculto')) return;
  });

  if (supabase.local) seloModoLocal();

  const sessao = await getSessao();
  viewCarregando.classList.add('oculto');
  if (sessao) {
    await mostrarPainel();
  } else {
    mostrarAuth();
  }
})();

/* ============================================================
   LOGIN / CADASTRO
   ============================================================ */
function mostrarAuth() {
  viewAuth.classList.remove('oculto');
  viewPainel.classList.add('oculto');

  const form     = document.getElementById('auth-form');
  const trocaLink = document.getElementById('auth-troca-link');

  form.onsubmit = aoEnviarAuth;
  trocaLink.onclick = () => { modoCadastro = !modoCadastro; atualizarTextosAuth(); };
  atualizarTextosAuth();
}

function atualizarTextosAuth() {
  document.getElementById('auth-titulo').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-sub').textContent = modoCadastro ? 'Comece a usar suas planilhas.' : 'Acesse suas planilhas.';
  document.getElementById('auth-botao').textContent = modoCadastro ? 'Cadastrar' : 'Entrar';
  document.getElementById('auth-troca-txt').textContent = modoCadastro ? 'Já tem conta?' : 'Não tem conta?';
  document.getElementById('auth-troca-link').textContent = modoCadastro ? 'Entrar' : 'Cadastre-se';
  document.getElementById('auth-senha').autocomplete = modoCadastro ? 'new-password' : 'current-password';
  esconderErro();
}

async function aoEnviarAuth(e) {
  e.preventDefault();
  esconderErro();
  const email = document.getElementById('auth-email').value.trim();
  const senha = document.getElementById('auth-senha').value;
  const botao = document.getElementById('auth-botao');
  botao.disabled = true;
  botao.textContent = modoCadastro ? 'Cadastrando…' : 'Entrando…';

  const { data, error } = modoCadastro ? await cadastrar(email, senha) : await login(email, senha);

  botao.disabled = false;
  atualizarTextosAuth();

  if (error) { mostrarErro(traduzErro(error.message)); return; }

  if (modoCadastro && !data.session) {
    // Projeto exige confirmação de e-mail
    mostrarErro('Conta criada! Verifique seu e-mail para confirmar e depois faça login.');
    modoCadastro = false; atualizarTextosAuth();
    return;
  }
  await mostrarPainel();
}

function mostrarErro(msg) { const el = document.getElementById('auth-erro'); el.textContent = msg; el.classList.remove('oculto'); }
function esconderErro() { document.getElementById('auth-erro').classList.add('oculto'); }
function traduzErro(m) {
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(m))        return 'Este e-mail já tem conta. Faça login.';
  if (/at least 6/i.test(m))                return 'A senha precisa ter ao menos 6 caracteres.';
  return m;
}

/* ============================================================
   PAINEL
   ============================================================ */
async function mostrarPainel() {
  usuario = await usuarioAtual();
  viewAuth.classList.add('oculto');
  viewPainel.classList.remove('oculto');

  document.getElementById('painel-email').textContent = usuario.email;
  document.getElementById('painel-avatar').textContent = (usuario.email || '?')[0];
  document.getElementById('btn-logout').onclick = logout;
  document.getElementById('painel-busca').oninput = (e) => renderGrade(e.target.value);

  await carregarPlanilhas();
}

async function carregarPlanilhas() {
  const grade = document.getElementById('painel-grade');
  grade.innerHTML = '<div class="vazio">Carregando planilhas…</div>';

  const { data, error } = await supabase
    .from('planilhas')
    .select('id, titulo, owner_id, atualizado_em')
    .order('atualizado_em', { ascending: false });

  if (error) { grade.innerHTML = '<div class="vazio">Erro ao carregar. Verifique a configuração do Supabase.</div>'; return; }
  todasPlanilhas = data || [];
  renderGrade('');
}

function renderGrade(filtro) {
  const grade = document.getElementById('painel-grade');
  grade.innerHTML = '';

  // Cartão "Nova planilha"
  const novo = document.createElement('div');
  novo.className = 'card card-novo';
  novo.innerHTML = '<div class="mais">+</div><div>Nova planilha</div>';
  novo.onclick = criarPlanilha;
  grade.appendChild(novo);

  const termo = (filtro || '').toLowerCase();
  const lista = todasPlanilhas.filter((p) => p.titulo.toLowerCase().includes(termo));

  lista.forEach((p) => grade.appendChild(montarCard(p)));

  if (!todasPlanilhas.length) {
    const vazio = document.createElement('div');
    vazio.className = 'vazio';
    vazio.style.gridColumn = '1 / -1';
    vazio.textContent = 'Nenhuma planilha ainda. Crie a primeira!';
    grade.appendChild(vazio);
  }
}

function montarCard(p) {
  const ehDono = p.owner_id === usuario.id;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="preview"><div class="ico">▦</div></div>
    <div class="corpo">
      <p class="titulo" title="${escapar(p.titulo)}">${escapar(p.titulo)}</p>
      <div class="meta">
        ${ehDono ? '' : '<span class="selo">Compartilhada</span>'}
        <span>${formatarData(p.atualizado_em)}</span>
      </div>
    </div>
    <div class="acoes">
      <button class="btn-icone" data-acao="compartilhar" title="Compartilhar" ${ehDono ? '' : 'style="display:none"'}>👥</button>
      <button class="btn-icone" data-acao="renomear" title="Renomear" ${ehDono ? '' : 'style="display:none"'}>✎</button>
      <button class="btn-icone" data-acao="excluir" title="Excluir" ${ehDono ? '' : 'style="display:none"'}>🗑</button>
    </div>`;

  // Abrir ao clicar fora dos botões de ação
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-acao]')) return;
    window.location.href = `editor.html?id=${p.id}`;
  });

  const bind = (acao, fn) => {
    const b = card.querySelector(`[data-acao="${acao}"]`);
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  };
  bind('compartilhar', () => abrirCompartilhar(p.id));
  bind('renomear', () => renomear(p));
  bind('excluir', () => excluir(p));

  return card;
}

async function criarPlanilha() {
  const dadosIniciais = [{
    name: 'Página1',
    index: '0',
    status: 1,
    order: 0,
    row: CONFIG.planilha.linhasPadrao,
    column: CONFIG.planilha.colunasPadrao,
    celldata: [],
    config: {},
  }];

  const { data, error } = await supabase
    .from('planilhas')
    .insert({ owner_id: usuario.id, titulo: 'Planilha sem título', dados: dadosIniciais })
    .select('id')
    .single();

  if (error) { toast('Não foi possível criar a planilha.', 'erro'); return; }
  window.location.href = `editor.html?id=${data.id}`;
}

async function renomear(p) {
  const novo = prompt('Novo nome da planilha:', p.titulo);
  if (novo === null) return;
  const titulo = novo.trim() || 'Planilha sem título';
  const { error } = await supabase.from('planilhas').update({ titulo }).eq('id', p.id);
  if (error) { toast('Erro ao renomear.', 'erro'); return; }
  p.titulo = titulo;
  renderGrade(document.getElementById('painel-busca').value);
  toast('Renomeada ✓', 'ok');
}

async function excluir(p) {
  if (!confirm(`Excluir "${p.titulo}"? Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabase.from('planilhas').delete().eq('id', p.id);
  if (error) { toast('Erro ao excluir.', 'erro'); return; }
  todasPlanilhas = todasPlanilhas.filter((x) => x.id !== p.id);
  renderGrade(document.getElementById('painel-busca').value);
  toast('Planilha excluída.');
}

/* ---------- utilitários ---------- */
function formatarData(iso) {
  const d = new Date(iso);
  return 'Editada ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
