/* ============================================================
   localBackend.js — MODO LOCAL (sem Supabase)
   Imita o subconjunto da API do Supabase que o app usa
   (auth + query builder) usando o localStorage do navegador.
   Ativado automaticamente quando as chaves do Supabase em
   config.js ainda são as de exemplo. Tudo fica só neste navegador.
   ============================================================ */

const DB_KEY      = 'planilha-local-db';
const USERS_KEY   = 'planilha-local-users';
const SESSION_KEY = 'planilha-local-session';

/* ---------- Persistência ---------- */
function lerDb() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || { planilhas: [], colaboradores: [] }; }
  catch { return { planilhas: [], colaboradores: [] }; }
}
function salvarDb(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }

function lerUsuarios() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}
function salvarUsuarios(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

function lerSessao() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
  catch { return null; }
}
function salvarSessao(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ============================================================
   Auth (imita supabase.auth.*)
   ============================================================ */
const auth = {
  async getSession() { return { data: { session: lerSessao() }, error: null }; },
  async getUser() { const s = lerSessao(); return { data: { user: s ? s.user : null }, error: null }; },

  async signUp({ email, password }) {
    email = String(email).toLowerCase().trim();
    const users = lerUsuarios();
    if (users.find((u) => u.email === email)) {
      return { data: { session: null, user: null }, error: { message: 'User already registered' } };
    }
    const user = { id: uuid(), email };
    users.push({ ...user, password });
    salvarUsuarios(users);
    const session = { user, access_token: 'local' };
    salvarSessao(session);                       // já loga (sem confirmação de e-mail)
    return { data: { session, user }, error: null };
  },

  async signInWithPassword({ email, password }) {
    email = String(email).toLowerCase().trim();
    const u = lerUsuarios().find((x) => x.email === email && x.password === password);
    if (!u) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
    const user = { id: u.id, email: u.email };
    const session = { user, access_token: 'local' };
    salvarSessao(session);
    return { data: { session, user }, error: null };
  },

  async signOut() { localStorage.removeItem(SESSION_KEY); return { error: null }; },
  onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
};

/* ============================================================
   Query builder (imita supabase.from(...).select/insert/...)
   É "thenable": pode ser await direto ou terminar em single().
   ============================================================ */
class ConsultaLocal {
  constructor(tabela) {
    this.tabela = tabela;
    this.op = 'select';
    this.filtros = [];
    this.ordenacao = null;
    this.modoSingle = null;   // 'single' | 'maybe' | null
    this.payload = null;
  }

  select() { return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col, val) { this.filtros.push({ col, val, modo: 'eq' }); return this; }
  ilike(col, val) { this.filtros.push({ col, val, modo: 'ilike' }); return this; }
  order(col, opts) { this.ordenacao = { col, ascending: opts ? opts.ascending !== false : true }; return this; }

  single() { this.modoSingle = 'single'; return this._executar(); }
  maybeSingle() { this.modoSingle = 'maybe'; return this._executar(); }
  then(resolve, reject) { return this._executar().then(resolve, reject); }

  _bate(r) {
    return this.filtros.every((f) => {
      const v = r[f.col];
      if (f.modo === 'ilike') return String(v ?? '').toLowerCase() === String(f.val ?? '').toLowerCase();
      // versao ausente em linhas antigas equivale a 1 (mesmo default do schema)
      if (f.col === 'versao') return (v ?? 1) === f.val;
      return v === f.val;
    });
  }

  async _executar() {
    const dados = lerDb();
    const linhas = dados[this.tabela] || (dados[this.tabela] = []);
    try {
      /* ---- SELECT ---- */
      if (this.op === 'select') {
        let res = linhas.filter((r) => this._bate(r));
        if (this.ordenacao) {
          const { col, ascending } = this.ordenacao;
          res = [...res].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
        }
        if (this.modoSingle) {
          if (!res.length) {
            return this.modoSingle === 'single'
              ? { data: null, error: { code: 'PGRST116', message: 'No rows found' } }
              : { data: null, error: null };
          }
          return { data: res[0], error: null };
        }
        return { data: res, error: null };
      }

      /* ---- INSERT ---- */
      if (this.op === 'insert') {
        const itens = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inseridos = [];
        for (const item of itens) {
          if (this.tabela === 'colaboradores') {
            const dup = linhas.find((r) =>
              r.planilha_id === item.planilha_id &&
              String(r.email ?? '').toLowerCase() === String(item.email ?? '').toLowerCase());
            if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          const agora = new Date().toISOString();
          const defaults = { id: uuid(), criado_em: agora, atualizado_em: agora };
          if (this.tabela === 'planilhas') defaults.versao = 1;  // imita DEFAULT 1 da coluna
          const linha = { ...defaults, ...item };
          linhas.push(linha);
          inseridos.push(linha);
        }
        salvarDb(dados);
        return { data: this.modoSingle ? inseridos[0] : inseridos, error: null };
      }

      /* ---- UPDATE ---- */
      // update().select() já devolve as linhas atingidas com todos os campos (incl. versao).
      // editor.js acessa linhasSalvas[0].versao diretamente — compatível com Supabase real.
      if (this.op === 'update') {
        const agora = new Date().toISOString();
        const atingidas = linhas.filter((r) => this._bate(r));
        // 0 linhas → filtro de versao não bateu → conflito (editor.js detecta pelo length)
        atingidas.forEach((r) => {
          const dadosAntes = r.dados;
          Object.assign(r, this.payload, { atualizado_em: agora });
          // imita o trigger tg_atualizado_em: incrementa versao só quando dados muda
          if ('dados' in this.payload &&
              JSON.stringify(r.dados) !== JSON.stringify(dadosAntes)) {
            r.versao = (r.versao ?? 1) + 1;
          }
        });
        salvarDb(dados);
        return { data: this.modoSingle ? (atingidas[0] || null) : atingidas, error: null };
      }

      /* ---- DELETE ---- */
      if (this.op === 'delete') {
        dados[this.tabela] = linhas.filter((r) => !this._bate(r));
        salvarDb(dados);
        return { data: null, error: null };
      }
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  }
}

/* ============================================================
   Cliente local
   ============================================================ */
export function createLocalClient() {
  return {
    local: true,
    auth,
    from(tabela) { return new ConsultaLocal(tabela); },
  };
}
