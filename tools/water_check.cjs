#!/usr/bin/env node
// The water, driven in a real browser. NODE_PATH=<dir>/node_modules
//   node tools/water_check.cjs sim                 5 simulated minutes at 1600x900 and 390x844
//   node tools/water_check.cjs perf                busiest moment and worst case
//   node tools/water_check.cjs motion <out.json>   tail against body length during real crossings
//   node tools/water_check.cjs arrive              ?arrive=1, reduced motion, i, console errors
//   node tools/water_check.cjs clip <dir> [secs] [seed] [from t]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = process.env.BENCH_ROOT || 'http://127.0.0.1:8918/';
function chromiumPath() {
  const dir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
  const v = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1])[0];
  return path.join(dir, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}
const errors = [];
async function browser() {
  return chromium.launch({ executablePath: chromiumPath(), headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
}
async function open(b, w, h, query, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dpr || 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.text()); console.log('CONSOLE', m.type(), m.text()); } });
  page.on('requestfailed', r => { errors.push('failed ' + r.url()); console.log('REQFAILED', r.url()); });
  page.on('response', r => { if (r.status() >= 400) { errors.push(r.status() + ' ' + r.url()); console.log('HTTP', r.status(), r.url()); } });
  await page.goto(`${ROOT}index.html?${query}`);
  await page.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
  return page;
}
const SIM = () => {
  const W = WATER, S = W.S, dt = 1 / 30;
  const stat = { steps: 0, flips: 0, popsIn: [], popsOut: [], maxActive: 0, spawned: 0, gone: 0, quiet: [], sideOnFrac: 0, maxAp: 0, longest: 0, stuck: 0, maxYaw: 0, slugs: {}, scr: {}, minProg: 1e9 };
  const live = new Map();
  let empty = 0, seenT = 0, sideT = 0, emptySince = null;
  const seen = (a, m) => {   // true projected box of the fish's extent, and its fade
    const e = a.f.extent, vp = S.vp;
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9, front = 0;
    for (const [x, y] of [[e[0], e[2]], [e[0], e[3]], [e[1], e[2]], [e[1], e[3]]]) {
      const M = m.model;
      const X = M[0] * x + M[4] * y + M[12], Y = M[1] * x + M[5] * y + M[13], Z = M[2] * x + M[6] * y + M[14];
      const cw = -Z;
      const nx = (vp[0] * X) / cw, ny = (vp[5] * Y) / cw;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    const on = x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1;
    const op = W.opacity(-m.pos[2]);
    return { on, op, vis: on ? op : 0, box: [x0, y0, x1, y1] };
  };
  for (let t = 0; t < 300; t += dt) {
    W.step(dt);
    stat.steps++;
    stat.maxActive = Math.max(stat.maxActive, S.active.length);
    if (S.active.length === 0) { if (emptySince === null) emptySince = t; } else if (emptySince !== null) { stat.quiet.push(+(t - emptySince).toFixed(1)); emptySince = null; }
    const now = new Set();
    let anyVisible = false;
    for (const a of S.active) {
      now.add(a.id);
      const m = W.modelOf(a);
      const s = seen(a, m);
      const tan = W.posAt(a, a.s).tan;
      if (!live.has(a.id)) {
        live.set(a.id, { a, sign: Math.sign(tan[0]), flip: m.flip, born: t, lastS: a.s, vis: s.vis, slug: a.f.slug, kind: a.kind, maxVis: 0 });
        stat.spawned++;
        if (s.vis > .02) stat.popsIn.push({ slug: a.f.slug, kind: a.kind, vis: s.vis, box: s.box });
      }
      const L = live.get(a.id);
      if (Math.sign(tan[0]) !== L.sign || m.flip !== L.flip) stat.flips++;
      if (t > L.born && a.s <= L.lastS) stat.stuck++;
      L.lastS = a.s; L.vis = s.vis; L.maxVis = Math.max(L.maxVis, s.vis);
      if (s.vis > .1) {
        anyVisible = true;
        const ap = W.apparent(m.pos, m.yaw);
        seenT += dt; if (ap < 8 * Math.PI / 180) sideT += dt;
        stat.maxAp = Math.max(stat.maxAp, ap);
        stat.maxYaw = Math.max(stat.maxYaw, Math.abs(m.yaw));
        const l = a.L * (a.f.rig.tail[0] - a.f.rig.head[0]) / a.f.rig.mesh.L;
        const px = (S.vp[5] / -m.pos[2]) * Math.abs(l) / 2;  // body length as a fraction of window height
        (stat.scr[a.f.slug] = stat.scr[a.f.slug] || []).push(px);
      }
    }
    if (!anyVisible) empty += dt;
    for (const [id, L] of live) {
      if (!now.has(id)) {
        if (L.vis > .02) stat.popsOut.push({ slug: L.slug, kind: L.kind, vis: L.vis });
        stat.gone++;
        stat.longest = Math.max(stat.longest, t - L.born);
        (stat.slugs[L.slug] = stat.slugs[L.slug] || []).push({ kind: L.kind, life: +(t - L.born).toFixed(0), peak: +L.maxVis.toFixed(2) });
        live.delete(id);
      }
    }
  }
  stat.sideOnFrac = sideT / Math.max(seenT, 1e-6);
  stat.emptyFrac = empty / 300;
  stat.scrRange = Object.fromEntries(Object.entries(stat.scr).map(([k, v]) => [k, [Math.min(...v).toFixed(2), Math.max(...v).toFixed(2)]]));
  delete stat.scr;
  stat.stillLive = live.size;
  stat.maxApDeg = stat.maxAp * 180 / Math.PI; stat.maxYawDeg = stat.maxYaw * 180 / Math.PI;
  return stat;
};
(async () => {
  const [cmd, a1, a2, a3] = process.argv.slice(2);
  const b = await browser();
  if (cmd === 'sim') {
    for (const [w, h] of [[1600, 900], [390, 844]]) {
      for (const seed of [11, 202]) {
        const page = await open(b, w, h, `manual=1&seed=${seed}`);
        const s = await page.evaluate(SIM);
        const q = s.quiet;
        console.log(`\n${w}x${h} seed ${seed}: spawned ${s.spawned}, gone ${s.gone}, live at end ${s.stillLive}, max at once ${s.maxActive}`);
        console.log(`  reversals ${s.flips}, stuck ${s.stuck}, pops in ${s.popsIn.length}, pops out ${s.popsOut.length}, longest life ${s.longest.toFixed(0)} s`);
        console.log(`  side-on under 8 deg: ${(100 * s.sideOnFrac).toFixed(1)}% of seen time, largest yaw ${s.maxYawDeg.toFixed(0)}, largest off-print ${s.maxApDeg.toFixed(0)} deg, empty window ${(100 * s.emptyFrac).toFixed(0)}% of the time`);
        console.log('  body length as share of window height:', JSON.stringify(s.scrRange));
        console.log('  lives:', JSON.stringify(s.slugs));
        if (s.popsIn.length || s.popsOut.length) console.log('  POPS', JSON.stringify(s.popsIn), JSON.stringify(s.popsOut));
        await page.context().close();
      }
    }
  } else if (cmd === 'perf') {
    // the real loop first, at the browser's own pace
    {
      const page = await open(b, 1600, 900, 'seed=11');
      await new Promise(r => setTimeout(r, 20000));
      const f = await page.evaluate(() => WATER.frames.slice(-600).concat());
      f.sort((x, y) => x - y);
      console.log(`real rAF loop, 20 s at 1600x900: ${f.length} frames, median ${f[f.length >> 1].toFixed(1)} ms, p95 ${f[(f.length * .95) | 0].toFixed(1)} ms, max ${f[f.length - 1].toFixed(1)} ms`);
      await page.context().close();
    }
    for (const [w, h, dpr] of [[1600, 900, 1], [1600, 900, 2], [390, 844, 3]]) {
      const page = await open(b, w, h, 'manual=1&seed=7', { dpr });
      const res = await page.evaluate(async () => {
        const W = WATER, S = W.S, gl = W.gl, px = new Uint8Array(4);
        // Busiest the piece gets: run forward to the most fish in view, measure there.
        for (let t = 0, k = 0; t < 300 && !(S.active.length >= (S.aspect < 1.2 ? 2 : 3)); t += .1) W.step(.1);
        const time = n => {
          const a = [];
          for (let i = 0; i < n; i++) {
            W.step(1 / 60);
            const t0 = performance.now();
            W.render();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            a.push(performance.now() - t0);
          }
          a.sort((x, y) => x - y);
          return { median: +a[n >> 1].toFixed(2), p95: +a[(n * .95) | 0].toFixed(2), max: +a[n - 1].toFixed(2) };
        };
        const busy = time(180), busyN = S.active.length;
        // Worst case the scope names: all ten at once.
        const had = S.active.length;
        for (const f of W.fishes) { if (!S.active.some(a => a.f === f)) { const x = W.spawn(f, { kind: 'cross' }); if (x) x.s = x.path.len * .5; } }
        const all = time(180), allN = S.active.length;
        return { canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight], busyN, busy, allN, all };
      });
      console.log(`${w}x${h} dpr ${dpr}:`, JSON.stringify(res));
      await page.context().close();
    }
  } else if (cmd === 'motion') {
    const out = [];
    for (const slug of ['bezaan', 'joulong-joulong', 'sambilang', 'jacob-everse-bigarre', 'kamboton', 'byenaneque']) {
      const page = await open(b, 1600, 900, `manual=1&seed=5&fish=${slug}`);
      const r = await page.evaluate(() => {
        const W = WATER, S = W.S, read = W.exposeReadback();
        S.nextSpawn = 1e9;
        const a = W.spawn(W.fishes[0], { kind: 'cross', near: [5, 7] });
        a.s = a.path.len * .32;
        const f = a.f, fl = new Float32Array(f.bin, f.rig.mesh.body.vert_off, f.rig.mesh.body.verts * 8);
        // pick vertices: tail tip, tail start, mid body, nose: all on the body's own mesh
        let tip = -1, nose = 0, mid = 0, peduncle = 0, bMid = 9, bPed = 9;
        for (let i = 0; i < f.body.verts; i++) {
          const x = fl[i * 8], y = fl[i * 8 + 1], s = fl[i * 8 + 4], d = fl[i * 8 + 5];
          if (s > .99 && Math.abs(y) < .15 && (tip < 0 || d > fl[tip * 8 + 5])) tip = i;
          if (x < fl[nose * 8]) nose = i;
          const dm = Math.abs(s - .5) + (d > 0 ? 9 : 0) + Math.abs(y) * .2;
          if (dm < bMid) { bMid = dm; mid = i; }
          const dp = Math.abs(s - .98) + (d > 0 ? 9 : 0) + Math.abs(y) * .2;
          if (dp < bPed) { bPed = dp; peduncle = i; }
        }
        const frames = [], H = W.canvas.height, Wd = W.canvas.width;
        const dt = 1 / 24;
        for (let i = 0; i < 24 * 16; i++) {
          W.step(dt);
          const c = read(a);
          const P = k => [(c[k * 4] / c[k * 4 + 3] * .5 + .5) * Wd, (.5 - c[k * 4 + 1] / c[k * 4 + 3] * .5) * H];
          frames.push({ tip: P(tip), nose: P(nose), mid: P(mid), ped: P(peduncle), phase: a.phase, t: S.t });
        }
        return { slug: f.slug, type: f.rig.type, tempo: f.base.tempo, swim: f.base, L: a.L, frames, v: a.v, verts: { tip, nose, mid, peduncle }, tipD: fl[tip * 8 + 5] };
      });
      const lenOnScreen = fr => Math.hypot(fr.ped[0] - fr.nose[0], fr.ped[1] - fr.nose[1]);
      const BL = r.frames.reduce((s, x) => s + lenOnScreen(x), 0) / r.frames.length;
      // tail against the body: position relative to the mid body, along and across the fish's line of travel
      const rel = (k, ref) => r.frames.map(x => x[k][0] - x[ref][0]);
      // One beat's moving average comes off first: over a crossing the fish foreshortens as its angle
      // to the camera changes, and that slow change is not swimming.
      const per = Math.round(24 / r.tempo);
      const hp = arr => arr.map((v, i) => {
        const a = Math.max(0, i - (per >> 1)), b = Math.min(arr.length, a + per);
        let m = 0; for (let k = a; k < b; k++) m += arr[k];
        return v - m / (b - a);
      }).slice(per, -per);
      const pp = arr => { const s = [...hp(arr)].sort((u, v) => u - v); return s[s.length - 2] - s[1]; };
      const tipX = rel('tip', 'mid'), pedX = rel('ped', 'mid'), noseX = rel('nose', 'mid');
      const steps = hp(tipX).slice(1).map((v, i) => Math.abs(v - hp(tipX)[i]));
      const sw = r.swim, Ftip = sw.flex * r.tipD / (1 + .6 * r.tipD);
      const row = {
        slug: r.slug, type: r.type,
        'BL px': +BL.toFixed(0), 'beats/s': +r.tempo.toFixed(2),
        'BL/s': +(r.v / r.L).toFixed(3),
        'waves on body': +(1 / sw.wavelength).toFixed(2),
        'tail side-to-side BL (true)': +(2 * (sw.amplitude + Ftip)).toFixed(3),
        'peduncle (true)': +(2 * sw.amplitude).toFixed(3),
        'midbody (true)': +(2 * sw.amplitude * (sw.head + (1 - sw.head) * Math.pow(.5, sw.envelope))).toFixed(3),
        'nose (true)': +(2 * sw.amplitude * sw.head).toFixed(3),
        'tip on screen BL': +(pp(tipX) / BL).toFixed(3),
        'nose on screen BL': +(pp(noseX) / BL).toFixed(3),
        'tip px/frame': +Math.max(...steps).toFixed(2),
      };
      out.push(row);
      console.log(JSON.stringify(row));
      if (a1) fs.writeFileSync(a1.replace('.json', `-${r.slug}.json`), JSON.stringify(r.frames));
      await page.context().close();
    }
  } else if (cmd === 'arrive') {
    // ?arrive=1: real time, no interaction, watch it finish
    const page = await open(b, 1600, 900, 'arrive=1&seed=3&fish=byenaneque');
    const t0 = Date.now();
    await page.waitForFunction('window.WATER && WATER.S.spawned === 1', null, { timeout: 30000 });
    const s0 = await page.evaluate(() => { const a = WATER.S.active[0]; return { len: a.path.len, v: a.v, slug: a.f.slug, kind: a.kind }; });
    console.log('arrive fish', s0, 'expected crossing', (s0.len / s0.v).toFixed(0), 's');
    await page.waitForFunction('window.WATER.S.stopped === true', null, { timeout: 180000, polling: 500 });
    const stopT = (Date.now() - t0) / 1000;
    await page.screenshot({ path: a1 || 'arrive-end.png' });
    const a = await page.evaluate(() => ({ active: WATER.S.active.length, stopped: WATER.S.stopped, rate: WATER.S.waterRate, log: WATER.log, spawned: WATER.S.spawned }));
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: (a1 || 'arrive-end.png').replace('.png', '-2s.png') });
    console.log(`stopped after ${stopT.toFixed(0)} s real time, active ${a.active}, spawned ${a.spawned}, log`, JSON.stringify(a.log));
    await page.context().close();
    // i toggles: real page, real key
    const p2 = await open(b, 1600, 900, 'seed=9');
    await p2.waitForFunction('WATER.S.active.length > 0', null, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1000));
    const l0 = await p2.evaluate(() => WATER.S.look);
    await p2.keyboard.press('i');
    await new Promise(r => setTimeout(r, 2500));
    const l1 = await p2.evaluate(() => WATER.S.look);
    await p2.keyboard.press('i');
    await new Promise(r => setTimeout(r, 2500));
    const l2 = await p2.evaluate(() => WATER.S.look);
    console.log(`i toggles: look ${l0} -> ${l1} -> ${l2}`);
    await p2.context().close();
    // reduced motion
    const p3 = await open(b, 1600, 900, 'seed=9', { reduced: true });
    await p3.waitForFunction('WATER.S.active.length > 0', null, { timeout: 60000 });
    const m0 = await p3.evaluate(() => WATER.S.active.map(a => [a.f.slug, a.s, a.phase, WATER.S.waterT]));
    await new Promise(r => setTimeout(r, 5000));
    const m1 = await p3.evaluate(() => WATER.S.active.map(a => [a.f.slug, a.s, a.phase, WATER.S.waterT, a.v]));
    await p3.screenshot({ path: (a1 || 'x.png').replace('.png', '-reduced.png') });
    m1.forEach((m, i) => console.log(`reduced: ${m[0]} moved ${((m[1] - m0[i][1]) / 5).toFixed(4)} world/s (normal ${m[4].toFixed(3)}), beats ${((m[2] - m0[i][2]) / 5 / 6.283).toFixed(3)}/s, water rate ${((m[3] - m0[i][3]) / 5).toFixed(3)}`));
    await p3.context().close();
  } else if (cmd === 'shot') {
    // one frame at a time t: shot <out.png> <seed> <t> [w] [h] [look]
    const w = +(process.argv[6] || 1600), h = +(process.argv[7] || 900), look = +(process.argv[8] || 0);
    const page = await open(b, w, h, `manual=1&seed=${a2}`);
    const url = await page.evaluate(([T, look]) => { const W = WATER; for (let t = 0; t < T; t += 1 / 24) W.step(1 / 24); W.S.look = W.S.lookTo = look; W.render(); return W.canvas.toDataURL('image/png'); }, [+a3, look]);
    fs.writeFileSync(a1, Buffer.from(url.split(',')[1], 'base64'));
    console.log(await page.evaluate(() => JSON.stringify(WATER.S.active.map(a => [a.f.slug, a.kind, +(-WATER.modelOf(a).pos[2]).toFixed(1)]))));
    await page.context().close();
  } else if (cmd === 'clip') {
    const secs = +(a2 || 45), seed = a3 || 11;
    fs.mkdirSync(a1, { recursive: true });
    const page = await open(b, 1600, 900, `manual=1&seed=${seed}`);
    const from = +(process.argv[6] || 0);
    await page.evaluate(T => { for (let t = 0; t < T; t += 1 / 24) WATER.step(1 / 24); }, from);
    const n = secs * 24;
    for (let i = 0; i < n; i++) {
      const url = await page.evaluate(() => { WATER.step(1 / 24); WATER.render(); return WATER.canvas.toDataURL('image/jpeg', .94); });
      fs.writeFileSync(path.join(a1, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(await page.evaluate(() => JSON.stringify(WATER.log)));
    await page.context().close();
  }
  console.log(errors.length ? `ERRORS ${errors.length}: ${[...new Set(errors)].join(' | ')}` : 'no console errors');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
