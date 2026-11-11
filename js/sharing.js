/* ============================================================
   sharing.js — compartilhamento com colaboradores (por e-mail)
   Também exporta o helper de toast usado pelo app.
   ============================================================ */

import supabase from './supabaseClient.js';

/* ---------- Toast (notificação) ---------- */
export function toast(msg, tipo = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (tipo ? ' ' + tipo : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2600);
}

/* ---------- Selo "Modo local" (persistente) ---------- */
export function seloModoLocal() {
  if (document.getElementById('selo-local')) return;
  const el = document.createElement('div');
  el.id = 'selo-local';
  el.textContent = '🖥 Modo local — dados só neste navegador';
  el.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:9999;background:#07233f;color:#fff;' +
    "font:600 12px/1 'Inter',sans-serif;padding:8px 13px;border-radius:999px;" +
    'box-shadow:0 6px 20px rgba(7,35,63,.3);opacity:.92;pointer-events:none';
  document.body.appendChild(el);
}

/* ---------- Modal (injetado uma única vez) ---------- */
let modalFundo, planilhaAtual;

function garantirModal() {
  if (modalFundo) return;
  modalFundo = document.createElement('div');
  modalFundo.className = 'modal-fundo oculto';
  modalFundo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-cab">
        <h3>Compartilhar planilha</h3>
        <button class="btn btn-icone" data-fechar aria-label="Fechar">✕</button>
      </div>
      <div class="modal-corpo">
        <div class="modal-linha-add">
          <input type="email" id="colab-email" placeholder="email@colaborador.com">
          <select id="colab-perm">
            <option value="editar">Pode editar</option>
            <option value="ver">Pode ver</option>
          </select>
          <button class="btn btn-primario" id="colab-add">Convidar</button>
        </div>
        <div class="colab-lista" id="colab-lista"></div>
      </div>
    </div>`;
  document.body.appendChild(modalFundo);

  modalFundo.addEventListener('click', (e) => {
    if (e.target === modalFundo || e.target.closest('[data-fechar]')) fechar();
  });
  modalFundo.querySelector('#colab-add').addEventListener('click', adicionar);
  modalFundo.querySelector('#colab-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adicionar();
  });
}

function fechar() { modalFundo.classList.add('oculto'); }

export async function abrirCompartilhar(planilhaId) {
  garantirModal();
  planilhaAtual = planilhaId;
  modalFundo.classList.remove('oculto');
  modalFundo.querySelector('#colab-email').value = '';
  await listar();
  modalFundo.querySelector('#colab-email').focus();
}

async function listar() {
  const lista = modalFundo.querySelector('#colab-lista');
  lista.innerHTML = '<div class="vazio" style="padding:1rem">Carregando…</div>';
  const { data, error } = await supabase
    .from('colaboradores')
    .select('*')
    .eq('planilha_id', planilhaAtual)
    .order('criado_em', { ascending: true });

  if (error) { lista.innerHTML = `<div class="vazio" style="padding:1rem">Erro ao carregar.</div>`; return; }
  if (!data.length) { lista.innerHTML = `<div class="vazio" style="padding:1rem">Ninguém ainda. Convide por e-mail acima.</div>`; return; }

  lista.innerHTML = '';
  data.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'colab-item';
    item.innerHTML = `
      <div class="email">${escapar(c.email)}</div>
      <span class="perm">${c.permissao === 'editar' ? 'Editor' : 'Leitor'}</span>
      <button class="btn btn-icone" title="Remover" aria-label="Remover">🗑</button>`;
    item.querySelector('button').addEventListener('click', () => remover(c.id));
    lista.appendChild(item);
  });
}

async function adicionar() {
  const emailEl = modalFundo.querySelector('#colab-email');
  const email = emailEl.value.trim().toLowerCase();
  const permissao = modalFundo.querySelector('#colab-perm').value;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { toast('E-mail inválido.', 'erro'); return; }

  const { error } = await supabase
    .from('colaboradores')
    .insert({ planilha_id: planilhaAtual, email, permissao });

  if (error) {
    toast(error.code === '23505' ? 'Esse e-mail já foi convidado.' : 'Não foi possível convidar.', 'erro');
    return;
  }
  emailEl.value = '';
  toast('Convite adicionado ✓', 'ok');
  listar();
}

async function remover(id) {
  const { error } = await supabase.from('colaboradores').delete().eq('id', id);
  if (error) { toast('Erro ao remover.', 'erro'); return; }
  toast('Colaborador removido.');
  listar();
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
