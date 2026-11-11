/* ============================================================
   editor.js — editor de uma planilha (Luckysheet + Supabase)
   ============================================================ */

import supabase from './supabaseClient.js';
import CONFIG from './config.js';
import { exigirLogin, usuarioAtual, logout } from './auth.js';
import { abrirCompartilhar, toast, seloModoLocal } from './sharing.js';

let planilhaId  = null;
let ehDono      = false;
let podeEditar  = false;
let salvando    = false;
let pendente    = false;   // há mudança não salva?
let timerAutoSave = null;
let criado      = false;   // true após hook workbookCreateAfter disparar
let versaoLocal = 1;       // versão carregada do servidor (trava otimista)

const elTitulo  = document.getElementById('titulo-planilha');
const elStatus  = document.getElementById('status-salvar');
const elSalvar  = document.getElementById('btn-salvar');
const elCompart = document.getElementById('btn-compartilhar');

/* ============================================================
   Início
   ============================================================ */
(async function init() {
  if (supabase.local) seloModoLocal();
  await exigirLogin();

  planilhaId = new URLSearchParams(location.search).get('id');
  if (!planilhaId) { location.href = 'index.html'; return; }

  document.getElementById('btn-voltar').onclick = voltar;
  document.getElementById('btn-logout').onclick = logout;

  const { data: planilha, error } = await supabase
    .from('planilhas').select('*').eq('id', planilhaId).single();

  if (error || !planilha) {
    toast('Planilha não encontrada ou sem acesso.', 'erro');
    setTimeout(() => (location.href = 'index.html'), 1200);
    return;
  }

  versaoLocal = planilha.versao ?? 1;

  const user = await usuarioAtual();
  ehDono = planilha.owner_id === user.id;
  podeEditar = ehDono;
  if (!ehDono) {
    const { data: colab } = await supabase
      .from('colaboradores').select('permissao')
      .eq('planilha_id', planilhaId)
      .ilike('email', user.email)
      .maybeSingle();
    podeEditar = colab?.permissao === 'editar';
  }

  configurarTopo(planilha);
  criarLuckysheet(planilha);
  window.addEventListener('beforeunload', aoSair);
})();

/* ============================================================
   Topo
   ============================================================ */
function configurarTopo(planilha) {
  elTitulo.value = planilha.titulo;
  document.title = `${planilha.titulo} — PLANILHA`;

  if (podeEditar) {
    elTitulo.disabled = false;
    elTitulo.addEventListener('change', salvarTitulo);
    elTitulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') elTitulo.blur(); });
    elSalvar.onclick = () => salvar(true);
  } else {
    elSalvar.classList.add('oculto');
    setStatus('Somente leitura');
  }

  if (ehDono) {
    elCompart.classList.remove('oculto');
    elCompart.onclick = () => abrirCompartilhar(planilhaId);
  }
}

async function salvarTitulo() {
  const titulo = elTitulo.value.trim() || 'Planilha sem título';
  elTitulo.value = titulo;
  document.title = `${titulo} — PLANILHA`;
  const { error } = await supabase.from('planilhas').update({ titulo }).eq('id', planilhaId);
  if (error) toast('Erro ao renomear.', 'erro');
  else toast('Nome salvo ✓', 'ok');
}

/* ============================================================
   Luckysheet
   ============================================================ */
function criarLuckysheet(planilha) {
  const dados = (Array.isArray(planilha.dados) && planilha.dados.length)
    ? planilha.dados
    : [{ name: 'Página1', index: '0', status: 1, order: 0,
         row: CONFIG.planilha.linhasPadrao, column: CONFIG.planilha.colunasPadrao,
         celldata: [], config: {} }];

  const { planilha: opt } = CONFIG;

  window.luckysheet.create({
    container: 'luckysheet',
    lang: opt.idioma,
    title: planilha.titulo,
    data: dados,
    plugins: opt.plugins,
    allowEdit: podeEditar,
    showtoolbar: opt.mostrarBarraFerramentas,
    showsheetbar: opt.mostrarAbas,
    showinfobar: opt.mostrarBarraInfo,
    showstatisticBar: opt.mostrarBarraEstatisticas,
    enableAddRow: podeEditar,
    enableAddBackTop: true,
    showRowBar: true,
    showColumnBar: true,
    hook: {
      // Causa raiz do check em salvar(): luckysheet.create() renderiza o canvas
      // de forma assíncrona. Antes de workbookCreateAfter disparar, getAllSheets()
      // lança exceção ou retorna dados inconsistentes.
      workbookCreateAfter() { criado = true; window._planilhaPronta = true; },
      updated() { if (podeEditar) agendarAutoSave(); },
    },
  });
}

/* ============================================================
   Auto-save (debounce) + salvamento
   ============================================================ */
function agendarAutoSave() {
  pendente = true;
  setStatus('Editando…');
  clearTimeout(timerAutoSave);
  timerAutoSave = setTimeout(() => salvar(false), CONFIG.planilha.intervaloAutoSalvar);
}

// _retries: uso interno para retry limitado (máx. 5 × 500ms = 2,5s)
async function salvar(manual, _retries = 0) {
  if (!podeEditar) return;

  if (!criado) {
    // workbookCreateAfter pode não disparar em ambientes sem repaint (ex.: headless).
    // Fallback: detectar readiness por getAllSheets() antes de desistir.
    try {
      if (Array.isArray(window.luckysheet?.getAllSheets()) && window.luckysheet.getAllSheets().length > 0) {
        console.warn('[PLANILHA] workbookCreateAfter não disparou — detectando readiness por getAllSheets()');
        criado = true;
      }
    } catch {}
  }

  if (!criado) {
    // hook workbookCreateAfter ainda não disparou — Luckysheet ainda inicializando canvas
    if (_retries === 0) {
      console.warn('[PLANILHA] salvar() chamado antes de Luckysheet estar pronto — aguardando canvas');
      if (manual) toast('Planilha ainda carregando, tente em instantes.');
    }
    if (_retries >= 5) {
      console.error('[PLANILHA] Luckysheet não ficou pronto após 5 tentativas (2,5s) — verifique o CDN ou erros no console');
      if (manual) toast('Não foi possível salvar — tente recarregar a página.', 'erro');
      return;
    }
    setTimeout(() => salvar(manual, _retries + 1), 500);
    return;
  }

  if (salvando) { pendente = true; return; }

  salvando = true;
  pendente = false;        // zera ANTES do await; edições durante o save reativam via hook.updated
  setStatus('Salvando…');
  clearTimeout(timerAutoSave);

  let dados;
  try {
    dados = window.luckysheet.getAllSheets();
  } catch (e) {
    salvando = false;
    pendente = true;       // não salvou; próximo ciclo de hook reativará o save
    setStatus('Erro ao ler dados');
    console.error('[PLANILHA] getAllSheets() falhou:', e);
    return;
  }

  // Trava otimista: .eq('versao') garante que só atualiza se ninguém salvou antes.
  // .select('versao') devolve a versão persistida pelo servidor (incrementada pelo trigger).
  const { data: linhasSalvas, error } = await supabase
    .from('planilhas')
    .update({ dados })
    .eq('id', planilhaId)
    .eq('versao', versaoLocal)
    .select('versao');

  salvando = false;

  if (error) {
    pendente = true;
    setStatus('Erro ao salvar');
    console.error('[PLANILHA] erro no save:', error);
    if (manual) toast('Não foi possível salvar.', 'erro');
    return;
  }

  // 0 linhas atualizadas = conflito (outra pessoa salvou e incrementou a versão)
  if (!linhasSalvas || linhasSalvas.length === 0) {
    pendente = true;
    mostrarConflito();
    return;
  }

  // versaoLocal vem do servidor, não de += 1
  versaoLocal = linhasSalvas[0].versao;
  setStatus('Salvo ✓');
  if (manual) toast('Planilha salva ✓', 'ok');
  if (pendente) agendarAutoSave();   // edições que vieram durante o await
}

/* ---- Conflito de versão (adj 4) ---- */
function mostrarConflito() {
  clearTimeout(timerAutoSave);   // pausa auto-save enquanto conflito está aberto
  setStatus('Conflito ⚠️');
  if (document.getElementById('conflito-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'conflito-banner';
  banner.innerHTML = `
    <span>⚠️ Outra pessoa salvou antes de você — seus dados ainda estão aqui.</span>
    <div class="conflito-acoes">
      <button id="cb-recarregar">Recarregar</button>
      <button id="cb-baixar">Baixar minha cópia</button>
      <button id="cb-sobrescrever">Sobrescrever</button>
    </div>`;
  document.querySelector('.editor-topbar').after(banner);
  document.getElementById('luckysheet').style.top = '88px';

  document.getElementById('cb-recarregar').onclick   = () => location.reload();
  document.getElementById('cb-baixar').onclick        = baixarCopia;
  document.getElementById('cb-sobrescrever').onclick  = sobrescrever;
}

function baixarCopia() {
  let dadosLocais;
  try { dadosLocais = window.luckysheet.getAllSheets(); } catch { dadosLocais = []; }
  const blob = new Blob([JSON.stringify(dadosLocais, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `${elTitulo.value.trim() || 'planilha'}-minha-copia.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

async function sobrescrever() {
  const { data, error } = await supabase
    .from('planilhas').select('versao').eq('id', planilhaId).single();
  if (error || !data) { toast('Erro ao buscar versão atual.', 'erro'); return; }
  versaoLocal = data.versao;
  document.getElementById('conflito-banner')?.remove();
  document.getElementById('luckysheet').style.top = '48px';
  salvar(true);
}

/* ============================================================
   Navegação / saída
   ============================================================ */
function voltar() {
  if (podeEditar && pendente) { salvar(false); }
  location.href = 'index.html';
}

function aoSair(e) {
  if (podeEditar && pendente) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
}

/* ---------- util ---------- */
function setStatus(txt) { elStatus.textContent = txt; }
