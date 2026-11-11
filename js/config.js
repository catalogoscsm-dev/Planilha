/* ============================================================
   config.js — CONFIGURAÇÃO CENTRAL DA PLANILHA
   Altere aqui para customizar o app (chaves, cores, opções).
   ============================================================ */

const CONFIG = {
  /* --- Supabase (preencha com os dados do seu projeto) --- */
  supabaseUrl: 'https://ibwttvcbhtejuekokzxx.supabase.co',
  supabaseAnonKey: 'sb_publishable_BnYYKCmuwnDXESaZC8_KVg_ps1fYgin',

  /* --- Identidade do app --- */
  nomeApp: 'PLANILHA',
  subtitulo: 'Sua planilha — azul, particular e sua.',

  /* --- Versão do Luckysheet (fixada p/ estabilidade) --- */
  luckysheetVersao: '2.1.13',

  /* --- Opções da planilha (passadas ao Luckysheet) --- */
  planilha: {
    linhasPadrao: 84,                 // linhas iniciais de uma planilha nova
    colunasPadrao: 60,                // colunas iniciais
    mostrarBarraFerramentas: true,    // barra de formatação (negrito, cor, etc.)
    mostrarAbas: true,                // abas de páginas na base
    mostrarBarraInfo: false,          // barra de info do Luckysheet (usamos a nossa)
    mostrarBarraEstatisticas: true,   // soma/média da seleção no rodapé
    plugins: ['chart'],               // gráficos
    idioma: 'es',                     // Luckysheet não tem pt-BR; 'es' é o + próximo
    intervaloAutoSalvar: 1500,        // debounce do auto-save (ms)
  },
};

export default CONFIG;
