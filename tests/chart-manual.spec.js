import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8000';

test('abrir editor, popular dados e inserir gráfico', async ({ page }) => {
  // ---- limpar estado local e fazer login ----
  await page.goto(BASE);
  await page.evaluate(() =>
    ['planilha-local-db','planilha-local-users','planilha-local-session']
      .forEach(k => localStorage.removeItem(k))
  );

  await page.waitForSelector('#view-auth:not(.oculto)', { timeout: 10000 });
  await page.fill('#auth-email', 'grafico@planilha.local');
  await page.fill('#auth-senha', 'senha123');
  await page.click('#auth-botao');

  try {
    await page.waitForSelector('#view-painel:not(.oculto)', { timeout: 2000 });
  } catch {
    await page.click('#auth-troca-link');
    await page.fill('#auth-email', 'grafico@planilha.local');
    await page.fill('#auth-senha', 'senha123');
    await page.click('#auth-botao');
    await page.waitForSelector('#view-painel:not(.oculto)', { timeout: 8000 });
  }

  // ---- criar planilha ----
  await page.click('.card-novo');
  await page.waitForURL(/editor\.html/, { timeout: 8000 });

  // aguarda Luckysheet pronto (getAllSheets + flowdata 2D inicializado)
  await page.waitForFunction(() => {
    try {
      const f = window.luckysheet?.getluckysheetfile?.();
      return Array.isArray(f) && f.length > 0 && Array.isArray(f[0]?.data);
    } catch { return false; }
  }, { timeout: 25000 });

  // ---- popular A1:B5 com dados de vendas ----
  await page.evaluate(() => {
    const ls = window.luckysheet;
    ls.setCellValue(0, 0, 'Mes');   ls.setCellValue(0, 1, 'Vendas');
    ls.setCellValue(1, 0, 'Jan');   ls.setCellValue(1, 1, 120);
    ls.setCellValue(2, 0, 'Fev');   ls.setCellValue(2, 1, 95);
    ls.setCellValue(3, 0, 'Mar');   ls.setCellValue(3, 1, 180);
    ls.setCellValue(4, 0, 'Abr');   ls.setCellValue(4, 1, 210);
    ls.setRangeShow({ row: [0, 4], column: [0, 1] });
  });

  await page.screenshot({ path: 'test-results/chart-1-dados.png' });

  await page.click('[data-tips="Gráfica"]', { timeout: 5000 });
  console.log('Clique em Gráfica OK');

  // dá 10s para qualquer loading terminar
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'test-results/chart-2-apos-click.png' });

  // diagnóstico completo do estado após o clique
  const diag = await page.evaluate(() => {
    const ls = window.luckysheet;
    return {
      // caminho direto
      chartparamType:  typeof ls?.chartparam,
      renderChartType: typeof ls?.chartparam?.renderChart,
      createChartType: typeof ls?.createChart,
      // busca qualquer chave com "chart" em window.luckysheet
      lsChartKeys: Object.keys(ls || {}).filter(k => /chart/i.test(k)),
      // busca em window diretamente
      windowChartKeys: Object.keys(window).filter(k => /chart|chartmix/i.test(k)),
      // verifica se chartmix foi carregado (exporta window.chartmix)
      chartmixType: typeof window.chartmix,
      // scripts no DOM
      scripts: Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.src.split('/').slice(-1)[0]),
      // console logs do Luckysheet (não capturáveis daqui, mas indica se Vue/Vuex ok)
      vueType:     typeof window.Vue,
      vuexType:    typeof window.Vuex,
      echartType:  typeof window.echarts,
      elementType: typeof window.ELEMENT,
    };
  });
  console.log('Diagnóstico após 10s:', JSON.stringify(diag, null, 2));

  // ---- screenshot final ----
  await page.screenshot({ path: 'test-results/chart-3-final.png' });
  console.log('Screenshots salvas em test-results/');
});
