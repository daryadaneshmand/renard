// Long simulated runs: how often is the window without a fish, judged from where fish really are on screen?
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [w, h] of [[1600, 900], [390, 844], [2560, 1080]]) for (const seed of [11, 202, 7]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:8918/index.html?manual=1&seed=${seed}`);
    await p.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
    const r = await p.evaluate(() => {
      const W = WATER, S = W.S, dt = 1 / 30, MIN = 30;
      let t = 0, gap = 0, longest = 0, gaps = [], maxShow = 0, faintGap = 0, longestFaint = 0, sum = 0, first = null, flips = 0;
      for (; t < MIN * 60; t += dt) {
        W.step(dt);
        let show = 0, anyFaint = false;
        for (const a of S.active) {
          const m = W.modelOf(a), P = m.pos, d = -P[2];
          const inside = Math.abs(P[0]) < S.tanW * d && Math.abs(P[1]) < S.tanH * d;
          if (inside && W.opacity(d) > .35) show++;
          if (inside && W.opacity(d) > .1) anyFaint = true;
        }
        if (show && first === null) first = t;
        maxShow = Math.max(maxShow, show); sum += show * dt;
        if (first !== null) {
          if (!show) { gap += dt; } else if (gap) { gaps.push(+gap.toFixed(2)); longest = Math.max(longest, gap); gap = 0; }
          if (!anyFaint) { faintGap += dt; longestFaint = Math.max(longestFaint, faintGap); } else faintGap = 0;
        }
      }
      return { first: first && +first.toFixed(1), gaps: gaps.length, longest: +longest.toFixed(2), longestFaint: +longestFaint.toFixed(2), avg: +(sum / (MIN * 60)).toFixed(2), maxShow, spawned: S.spawned };
    });
    console.log(`${w}x${h} seed ${seed}:`, JSON.stringify(r), errs.length ? errs : '');
    await ctx.close();
  }
  await b.close();
})();
