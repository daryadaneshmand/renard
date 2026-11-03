#!/usr/bin/env node
// Drive the bench in a real browser. Playwright lives outside the repo: NODE_PATH=<dir>/node_modules
//   node tools/capture.cjs frames <outdir> [slug ...]    8 phases, both looks, per fish
//   node tools/capture.cjs readback <outdir> [slug ...]  vertex shader output as numbers
//   node tools/capture.cjs clip <outdir> <slug> [frames] [look]  evenly stepped frames for ffmpeg
//   node tools/capture.cjs perf                          frame time with all rigs loaded
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.env.BENCH_URL || 'http://127.0.0.1:8918/swim.html';

// Use whichever Chromium Playwright has cached; the module version need not match.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
  const v = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])[0];
  for (const sub of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
    const p = path.join(dir, v, sub);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no cached chromium');
}

async function open(w, h) {
  const browser = await chromium.launch({
    executablePath: chromiumPath(), headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(`${URL_}?still=1&hide=1&w=${w}&h=${h}`);
  await page.waitForFunction('window.BENCH_READY === true', null, { timeout: 120000 });
  const info = await page.evaluate(() => {
    const gl = BENCH.gl, e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', info);
  return { browser, page };
}
const save = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

(async () => {
  const [cmd, out, ...rest] = process.argv.slice(2);
  if (out && cmd !== 'perf') fs.mkdirSync(out, { recursive: true });
  if (cmd === 'frames') {
    const { browser, page } = await open(1500, 1000);
    const all = rest.length ? rest : await page.evaluate(() => BENCH.index.fish);
    for (const slug of all) {
      await page.evaluate(s => BENCH.setFish(s), slug);
      for (const look of [0, 1]) for (let i = 0; i < 8; i++) {
        const url = await page.evaluate(([i, look]) => BENCH.shot(i * Math.PI / 4, look, 24), [i, look]);
        save(path.join(out, `${slug}-${look ? 'ink' : 'color'}-${i}.png`), url);
      }
      console.log(slug);
    }
    await browser.close();
  } else if (cmd === 'readback') {
    const { browser, page } = await open(1000, 620);
    const all = rest.length ? rest : await page.evaluate(() => BENCH.index.fish);
    for (const slug of all) {
      await page.evaluate(s => BENCH.setFish(s), slug);
      const res = await page.evaluate(() => {
        const r = [];
        for (const ph of [0, 1.1, 2.7, 4.4]) {
          BENCH.cur.phase = ph;
          r.push({ part: -1, ...BENCH.readback(-1) });
          BENCH.cur.fins.forEach((_, i) => r.push({ part: i, ...BENCH.readback(i) }));
        }
        return r;
      });
      fs.writeFileSync(path.join(out, slug + '.json'), JSON.stringify(res));
      console.log(slug, res.length);
    }
    await browser.close();
  } else if (cmd === 'clip') {
    const slug = rest[0], n = +(rest[1] || 96), look = +(rest[2] || 0);
    const { browser, page } = await open(1000, 620);
    await page.evaluate(s => BENCH.setFish(s), slug);
    const tempo = await page.evaluate(() => BENCH.cur.swim.tempo);
    for (let i = 0; i < n; i++) {
      // real time at 24 fps
      const ph = 2 * Math.PI * tempo * i / 24;
      const url = await page.evaluate(([ph, look]) => BENCH.shot(ph, look, 24), [ph, look]);
      save(path.join(out, `f${String(i).padStart(4, '0')}.png`), url);
    }
    await browser.close();
  } else if (cmd === 'tempo') {
    // Tempo changes mid-swim: phase must keep accumulating and no vertex may jump.
    const { browser, page } = await open(1000, 620);
    await page.evaluate(s => BENCH.setFish(s), rest[0] || out || 'bezaan');
    const res = await page.evaluate(() => new Promise(done => {
      const B = BENCH, f = B.cur, log = [];
      B.S.playing = true;
      let n = 0, prevTail = null;
      const base = f.swim.tempo;
      function step() {
        n++;
        if (n === 60) f.swim.tempo = base * 3;
        if (n === 90) f.swim.tempo = base * .25;
        const clip = B.readback(-1).clip;
        // the farthest vertex out along the tail
        let k = 0, best = -1e9;
        const fl = f.floats;
        for (let i = 0; i < f.rig.mesh.body.verts; i += 7) if (fl[i * 8] > best) { best = fl[i * 8]; k = i; }
        const x = clip[k * 4] / clip[k * 4 + 3];
        log.push({ n, phase: f.phase, x, tempo: f.swim.tempo });
        if (n < 120) requestAnimationFrame(step); else done(log);
      }
      requestAnimationFrame(step);
    }));
    let maxD = 0, maxX = 0;
    for (let i = 1; i < res.length; i++) {
      const d = res[i].phase - res[i - 1].phase;
      const allowed = 2 * Math.PI * Math.max(res[i].tempo, res[i - 1].tempo) * 0.05 + 1e-6;
      if (d < 0 || d > allowed) console.log('PHASE JUMP at', res[i].n, d, allowed);
      maxD = Math.max(maxD, d);
      maxX = Math.max(maxX, Math.abs(res[i].x - res[i - 1].x));
    }
    console.log(`tempo x3 at frame 60, x0.25 at frame 90: largest phase step ${maxD.toFixed(4)} rad, largest tail-tip step ${(maxX * 500).toFixed(2)} px per frame at 1000 px`);
    await browser.close();
  } else if (cmd === 'correct') {
    // Drive the correction tool: move a handle, save, read the file it downloads.
    const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
    const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } })).newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    const root = URL_.replace('swim.html', '');
    await page.goto(`${root}tools/correct.html?fish=${rest[0] || 'bongon'}`);
    await page.waitForFunction('window.CORRECT_READY === true');
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(CORRECT.rig.body.top)));
    const pt = await page.evaluate(() => { const r = CORRECT.rig, c = document.getElementById('c').getBoundingClientRect(), p = CORRECT.S(r.body.x[5], r.body.top[5]); return [c.left + p[0], c.top + p[1]]; });
    await page.mouse.move(pt[0], pt[1]); await page.mouse.down(); await page.mouse.move(pt[0], pt[1] - 14, { steps: 4 }); await page.mouse.up();
    // box a new fin, then a cut
    await page.click('[data-mode=fin]');
    await page.mouse.move(pt[0] + 40, pt[1] + 40); await page.mouse.down(); await page.mouse.move(pt[0] + 120, pt[1] + 80, { steps: 4 }); await page.mouse.up();
    await page.click('[data-mode=cut]');
    await page.mouse.move(pt[0] + 10, pt[1] - 60); await page.mouse.down(); await page.mouse.move(pt[0] + 60, pt[1] - 30, { steps: 4 }); await page.mouse.up();
    await page.screenshot({ path: path.join(out, 'correct.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
    await dl.saveAs(path.join(out, 'correct-saved.json'));
    const saved = JSON.parse(fs.readFileSync(path.join(out, 'correct-saved.json')));
    const e = saved[rest[0] || 'bongon'];
    console.log('file', dl.suggestedFilename(), 'fish in file', Object.keys(saved).length);
    console.log('top[5]', before[5], '->', e.body.top[5], 'fins', e.fins.length, 'cuts', (e.cut || []).length);
    await browser.close();
  } else if (cmd === 'perf') {
    const { browser, page } = await open(1600, 900);
    for (const [w, h] of [[1600, 900], [3200, 1800]]) {
      console.log(await page.evaluate(([w, h]) => BENCH.perfAll(w, h), [w, h]));
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
