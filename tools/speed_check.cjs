// The arrow keys: real key presses move the speed, nothing jumps, the window stays covered at both ends of the range.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const fail = [];
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail.push(what); };

  // Keys, on a running page.
  {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://127.0.0.1:8918/index.html?seed=44');
    await p.waitForFunction('window.WATER_READY === true', null, { timeout: 60000 });
    const speed = () => p.evaluate(() => ({ to: WATER.S.speedTo, now: WATER.S.speed, held: WATER.S.speedHeld }));
    await p.waitForFunction('WATER.S.active.length > 0', null, { timeout: 30000 });
    check((await speed()).to === 1, 'starts at 1');
    await p.keyboard.press('ArrowRight'); let s = await speed();
    check(s.to > 1.2 && s.to < 1.35 && s.held === 0, `right tap raises it: ${s.to.toFixed(3)}`);
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); s = await speed();
    check(s.to < 1 && s.to > .7 && s.held === 0, `two left taps lower it: ${s.to.toFixed(3)}`);
    await p.keyboard.down('ArrowRight'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowRight'); s = await speed();
    check(s.to > 2 && s.held === 0, `3 s hold right climbs and lets go: ${s.to.toFixed(3)}`);
    await p.keyboard.down('ArrowRight'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowRight'); s = await speed();
    check(s.to === 4, `stops at the top: ${s.to}`);
    await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(6000); await p.keyboard.up('ArrowLeft'); s = await speed();
    check(Math.abs(s.to - .1) < 1e-9, `stops at the floor: ${s.to}`);
    const before = s.to, url = p.url();
    await p.keyboard.press('Meta+ArrowLeft'); s = await speed();
    check(s.to === before && p.url() === url, 'Cmd-Left leaves the speed alone');
    await p.keyboard.press('ArrowRight');
    const moved = await p.evaluate(async () => {
      const a = WATER.S.active[0], s0 = a.s, ph0 = a.phase;
      await new Promise(r => setTimeout(r, 1000));
      return { ds: a.s - s0, dph: a.phase - ph0 };
    });
    check(moved.ds > 0 && moved.dph > 0, 'still swimming forward at the floor');
    check(!errs.length, `no page errors ${errs}`);
    await ctx.close();
  }

  // Sudden changes, simulated: position and tail only move forward, by no more than the fastest pace allows.
  for (const seed of [11, 202]) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:8918/index.html?manual=1&seed=${seed}`);
    await p.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
    const r = await p.evaluate(() => {
      const W = WATER, S = W.S, dt = 1 / 60;
      let back = 0, maxStepRatio = 0, maxEase = 0, prev = new Map();
      for (let i = 0; i < 60 * 240; i++) {
        if (i % 300 === 0) S.speedTo = [.1, 4, 1, 4, .1, 2][(i / 300) % 6];
        const sp = S.speed;
        W.step(dt);
        maxEase = Math.max(maxEase, Math.abs(S.speed - sp));
        for (const a of S.active) {
          const q = prev.get(a);
          if (q) {
            if (a.s < q.s || a.phase < q.phase) back++;
            maxStepRatio = Math.max(maxStepRatio, (a.s - q.s) / (a.v * dt * 1.22 * 4));
          }
          prev.set(a, { s: a.s, phase: a.phase });
        }
      }
      return { back, maxStepRatio: +maxStepRatio.toFixed(3), maxEase: +maxEase.toFixed(3) };
    });
    check(r.back === 0, `seed ${seed}: nothing goes backward`);
    check(r.maxStepRatio <= 1.001, `seed ${seed}: no jump past the fastest pace, ${r.maxStepRatio}`);
    console.log(`     largest change in speed in one frame, ${r.maxEase}`);
    await ctx.close();
  }

  // Coverage held at one speed for a long run, and flipping between the extremes.
  const runs = [['slow', () => .1], ['fast', () => 4], ['flip', i => (Math.floor(i / 300) % 2 ? 4 : .1)]];
  for (const [w, h] of [[1600, 900], [390, 844]]) for (const seed of [11, 202]) for (const [name] of runs) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:8918/index.html?manual=1&seed=${seed}`);
    await p.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
    const r = await p.evaluate(({ name }) => {
      const W = WATER, S = W.S, dt = 1 / 30;
      const pick = { slow: () => .1, fast: () => 4, flip: i => (Math.floor(i / 300) % 2 ? 4 : .1) }[name];
      // simulated time long enough for the same number of fish whatever the pace
      const secs = name === 'slow' ? 3600 : name === 'fast' ? 600 : 1800;
      let gap = 0, longest = 0, gaps = 0, first = null, maxShow = 0;
      for (let i = 0; i < secs / dt; i++) {
        if (first !== null || name !== 'slow') S.speedTo = pick(i);   // the slow run starts once a fish is showing
        W.step(dt);
        let show = 0;
        for (const a of S.active) {
          const m = W.modelOf(a), P = m.pos, d = -P[2];
          if (Math.abs(P[0]) < S.tanW * d && Math.abs(P[1]) < S.tanH * d && W.opacity(d) > .35) show++;
        }
        maxShow = Math.max(maxShow, show);
        if (show && first === null) first = i * dt;
        if (first !== null) { if (!show) gap += dt; else if (gap) { gaps++; longest = Math.max(longest, gap); gap = 0; } }
      }
      return { first: first && +first.toFixed(1), gaps, longest: +longest.toFixed(2), maxShow, spawned: S.spawned };
    }, { name });
    check(r.gaps === 0, `${w}x${h} seed ${seed} ${name}: ${JSON.stringify(r)}`);
    await ctx.close();
  }
  await b.close();
  console.log(fail.length ? `${fail.length} FAILED` : 'all passed');
  process.exit(fail.length ? 1 : 0);
})();
