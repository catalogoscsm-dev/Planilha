/* ============================================================
   supabaseClient.js — cliente do app
   Usa o Supabase se as chaves estiverem preenchidas em config.js.
   Caso contrário, cai automaticamente no MODO LOCAL (localStorage),
   sem rede, para você testar na hora.
   ============================================================ */

import CONFIG from './config.js';

function configurado() {
  const url = CONFIG.supabaseUrl || '';
  const key = CONFIG.supabaseAnonKey || '';
  return url.startsWith('https://') &&
         !url.includes('SEU-PROJETO') &&
         key.length > 20 &&
         !key.includes('SUA-ANON-KEY');
}

let supabase;

if (configurado()) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
} else {
  const { createLocalClient } = await import('./localBackend.js');
  supabase = createLocalClient();
  console.info('%c[PLANILHA] Modo local ativo — dados salvos só neste navegador. Configure o Supabase em js/config.js para usar a nuvem.', 'color:#1a73e8;font-weight:bold');
}

export default supabase;
