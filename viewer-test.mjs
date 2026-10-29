// Smoke test for the viewer: starts the local dev server, opens the page in live mode, clicks through
// the panels, the world menu and the sandbox, and fails on any page error. Needs Playwright with Chromium.
//   node viewer-test.mjs [port]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const PORT = +process.argv[2] || 8799;
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
catch (e) { console.log('Playwright is not installed here. Run: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const server = spawn(process.execPath, ['dev-server.mjs', String(PORT)], { env: Object.assign({}, process.env, { WARM: '3' }), stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('dev server on')) res(); }); server.on('exit', c => rej(new Error('dev server exited ' + c))); });

const errors = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  await ctx.addInitScript(() => localStorage.setItem('twelve-opts', JSON.stringify({ quality: 'low', director: true })));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.click(); }, sel);
  const step = async (name, fn) => {
    try { await fn(); console.log('ok', name); }
    catch (e) {
      const state = await page.evaluate(() => { const t = window.__twelve; return t ? { mode: t.st.mode, wid: t.st.wid, worldMenuOpen: !document.querySelector('#worldMenu').hidden, toast: document.querySelector('#toast').textContent } : 'not booted'; }).catch(() => 'page not responding');
      throw new Error(`step "${name}" failed: ${e.message.split('\n')[0]}\nstate: ${JSON.stringify(state)}\npage errors: ${errors.join(' | ') || 'none'}`);
    }
  };
  await step('load live world', async () => {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__twelve && window.__twelve.st.mode === 'live' && window.__twelve.S.W.people.length > 0, null, { timeout: 120000, polling: 500 });
  });
  await step('panels', async () => {
    for (const t of ['web', 'family', 'story', 'stats', 'cast']) { await click(`.tab[data-tab="${t}"]`); await page.waitForTimeout(400); }
    await click('#pane-cast .prow');
    await page.waitForFunction(() => !document.querySelector('#inspector').hidden, null, { timeout: 30000, polling: 500 });
  });
  await step('switch world', async () => {
    const id = await page.evaluate(() => (window.__twelve.st.worlds[1] || {}).id);
    if (!id) return;
    await click('#worldBtn');
    await click(`[data-world="${id}"]`);
    await page.waitForFunction(i => window.__twelve.st.wid === i, id, { timeout: 120000, polling: 500 });
  });
  await step('sandbox', async () => {
    await click('#worldBtn');
    await click('[data-sandbox="open"]');
    await page.waitForFunction(() => window.__twelve.st.mode === 'sandbox', null, { timeout: 120000, polling: 500 });
    await page.evaluate(() => { const { S } = window.__twelve; S.advanceTo(S.W.t + S.HPY, { maxSteps: 40000 }); });
    await page.waitForTimeout(3000);
  });
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log('FAILED\n' + errors.join('\n')); process.exit(1); }
console.log('viewer ok');
