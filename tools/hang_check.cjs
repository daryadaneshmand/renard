// A lone fish whose file never answers: its turn passes and the water keeps going.
const { chromium } = require('playwright');
const ROOT = process.env.BENCH_ROOT || 'http://127.0.0.1:8918/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/assets/fish/bezaan/mesh.bin', () => {});     // never answered
  await p.goto(`${ROOT}index.html?seed=11&fish=bezaan,kamboton,macreel`);
  await p.waitForFunction('window.WATER_READY === true', null, { timeout: 60000 });
  await p.waitForTimeout(45000);
  const r = await p.evaluate(() => ({ spawned: WATER.S.spawned, active: WATER.S.active.map(a => a.f.slug), log: (WATER.log || []).filter(e => e.ev === 'spawn').map(e => e.slug) }));
  console.log(JSON.stringify(r));
  const ok = r.spawned > 0 && !r.log.includes('bezaan') && !errs.length;
  console.log(ok ? 'ok   others swim, the hung fish does not' : `FAIL ${errs}`);
  await b.close();
  process.exit(ok ? 0 : 1);
})();
