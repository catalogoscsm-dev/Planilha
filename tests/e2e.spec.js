import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8000';

/* ============================================================
   Helpers
   ============================================================ */

/** Login ou cadastro automático. */
async function entrar(page, email = 'e2e@planilha.local', senha = 'senha123') {
  await page.goto(BASE);
  await page.waitForSelector('#view-auth:not(.oculto)', { timeout: 10000 });
  await page.fill('#auth-email', email);
  await page.fill('#auth-senha', senha);
  await page.click('#auth-botao');

  // Aguarda painel ou formulário ainda visível (login falhou → cadastrar)
  try {
    await page.waitForSelector('#view-painel:not(.oculto)', { timeout: 2000 });
    return;
  } catch {
    // sem sessão → conta não existia: cadastrar
  }
  await page.click('#auth-troca-link');
  await page.fill('#auth-email', email);
  await page.fill('#auth-senha', senha);
  await page.click('#auth-botao');
  await page.waitForSelector('#view-painel:not(.oculto)', { timeout: 8000 });
}

/** Aguarda Luckysheet estar totalmente pronto (canvas inicializado).
 *  Estratégia: getAllSheets() deve retornar um array não-vazio.
 *  O hook workbookCreateAfter do Luckysheet 2.1.13 não dispara de forma
 *  confiável em headless Chromium; usar getAllSheets() como sinal empírico
 *  é mais robusto — o page snapshot confirma que a UI está renderizada. */
async function aguardarLucky(page) {
  await page.waitForFunction(
    () => {
      try {
        const s = window.luckysheet?.getAllSheets?.();
        return Array.isArray(s) && s.length > 0;
      } catch { return false; }
    },
    { timeout: 25000 }
  );
}

/**
 * Guarda de modo local: aborta o teste se o selo "#selo-local" não estiver
 * visível, evitando criar usuários em um Supabase real.
 */
async function exigirModoLocal(page) {
  if (!page.url().startsWith(BASE)) await page.goto(BASE);
  const isLocal = await page.locator('#selo-local')
    .isVisible({ timeout: 5000 }).catch(() => false);
  if (!isLocal) {
    test.skip(true, 'Modo local não detectado — abortando para não afetar Supabase real');
  }
  return isLocal;
}

/** Limpa o localStorage de teste para isolar cada execução. */
async function limparEstado(page) {
  await page.evaluate(() =>
    ['planilha-local-db', 'planilha-local-users', 'planilha-local-session']
      .forEach(k => localStorage.removeItem(k))
  );
}

/* ============================================================
   E2E LOCAL — guard: só roda quando selo "Modo local" está visível
   ============================================================ */
test.describe('E2E local', () => {

  /* ----------------------------------------------------------
     FLUXO: criar → editar → salvar → recarregar → conferir
     ---------------------------------------------------------- */
  test('criar → editar → salvar → recarregar → conferir persistência', async ({ page }) => {
    await page.goto(BASE);
    await exigirModoLocal(page);
    await limparEstado(page);

    await entrar(page);

    // Criar nova planilha
    await page.click('.card-novo');
    await page.waitForURL(/editor\.html/, { timeout: 8000 });
    await aguardarLucky(page);

    // Editar célula A1 via API do Luckysheet (evita depender de coordenadas canvas)
    await page.evaluate(() => window.luckysheet.setCellValue(0, 0, 42));

    // Salvar manualmente e confirmar feedback
    await page.click('#btn-salvar');
    await expect(page.locator('#status-salvar')).toHaveText('Salvo ✓', { timeout: 6000 });

    // Recarregar e confirmar persistência
    await page.reload();
    await aguardarLucky(page);

    const valor = await page.evaluate(() => {
      const sheets = window.luckysheet.getAllSheets();
      const cell   = (sheets[0]?.celldata ?? []).find(c => c.r === 0 && c.c === 0);
      return cell?.v?.v ?? cell?.v ?? null;
    });
    expect(valor).toBe(42);
  });

  /* ----------------------------------------------------------
     CONFLITO: duas abas, segunda detecta e exibe 3 botões.
     Usa o mesmo contexto do navegador (compartilha localStorage),
     simulando duas abas do mesmo usuário.
     ---------------------------------------------------------- */
  test('conflito otimista: segunda aba detecta e exibe 3 botões', async ({ page }) => {
    await page.goto(BASE);
    await exigirModoLocal(page);
    await limparEstado(page);

    await entrar(page);
    await page.click('.card-novo');
    await page.waitForURL(/editor\.html/);
    await aguardarLucky(page);

    const editorUrl = page.url();

    // Segunda aba no MESMO contexto → compartilha localStorage
    const ctx   = page.context();
    const pageB = await ctx.newPage();
    await pageB.goto(editorUrl);
    await aguardarLucky(pageB);
    // pageB carregou com versaoLocal = 1

    // Aba A edita e salva → trigger incrementa versao para 2 no localStorage
    await page.evaluate(() => window.luckysheet.setCellValue(0, 0, 10));
    await page.click('#btn-salvar');
    await expect(page.locator('#status-salvar')).toHaveText('Salvo ✓', { timeout: 6000 });

    // Aba B edita (versaoLocal dela ainda é 1) → save deve detectar conflito
    await pageB.evaluate(() => window.luckysheet.setCellValue(0, 1, 99));
    await pageB.click('#btn-salvar');

    // Banner de conflito deve aparecer
    await expect(pageB.locator('#conflito-banner')).toBeVisible({ timeout: 6000 });
    await expect(pageB.locator('#status-salvar')).toHaveText('Conflito ⚠️');
    await expect(pageB.locator('#cb-recarregar')).toBeVisible();
    await expect(pageB.locator('#cb-baixar')).toBeVisible();
    await expect(pageB.locator('#cb-sobrescrever')).toBeVisible();

    // Auto-save deve permanecer pausado após 2,2s
    await pageB.waitForTimeout(2200);
    await expect(pageB.locator('#status-salvar')).toHaveText('Conflito ⚠️');

    await pageB.close();
  });

});

/* ============================================================
   PERMISSÕES: transferir_planilhas — requer Supabase real.
   Guard inverso: skip se modo local estiver ativo.
   ============================================================ */
test.describe('Permissões: transferir_planilhas [requer Supabase]', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    const isLocal = await page.locator('#selo-local')
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (isLocal) {
      test.skip(true, 'Modo local ativo — testes de SQL requerem Supabase configurado');
    }
  });

  test('anon sem token deve receber erro de permissão via REST', async ({ page }) => {
    // Chama diretamente o endpoint RPC sem autenticação (somente apikey anon)
    const resultado = await page.evaluate(async () => {
      const { supabaseUrl, supabaseAnonKey } = (await import('/js/config.js')).default;
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/transferir_planilhas`, {
        method:  'POST',
        headers: { 'apikey': supabaseAnonKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ de_email: 'x@x.com', para_email: 'y@y.com' }),
      });
      return { status: resp.status, body: await resp.text() };
    });
    // anon role não tem EXECUTE (revogado) → 403 ou body contendo "permission"
    const negado =
      resultado.status >= 400 ||
      /permission|denied|not found/i.test(resultado.body);
    expect(negado).toBe(true);
  });

  test('usuário autenticado não-admin deve receber "Acesso negado"', async ({ page }) => {
    // Login como usuário comum (sem inserção em admins)
    await entrar(page, `comum_${Date.now()}@teste.planilha`, 'senha123e2e');

    const resultado = await page.evaluate(async () => {
      // supabaseClient.js expõe o cliente real quando Supabase está configurado
      const { default: supabase } = await import('/js/supabaseClient.js');
      const { data, error } = await supabase.rpc('transferir_planilhas', {
        de_email: 'alguem@teste.com', para_email: 'outro@teste.com',
      });
      return { data, errorMsg: error?.message ?? '' };
    });

    expect(resultado.errorMsg).toMatch(/Acesso negado/i);
  });

});
