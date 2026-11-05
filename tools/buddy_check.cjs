#!/usr/bin/env node
// Companions: do the three pairs read as two fish traveling together, and does everything around them hold?
// Numbers only, and from simulated time. Nothing here says how they look moving. NODE_PATH=<dir>/node_modules
//   node tools/buddy_check.cjs             all of it
//   node tools/buddy_check.cjs pairs       each pair, many crossings, speeds 1, 0.1 and 4, two window shapes
//   node tools/buddy_check.cjs normal      the whole catalog: bag turns, nobody alone, nobody bumped, count of fish
//   node tools/buddy_check.cjs real        the real loop: eviction, a partner that fails or hangs, query options, arrow keys
const { chromium } = require('playwright');
const ROOT = process.env.BENCH_ROOT || 'http://127.0.0.1:8918/';
const PAIRS = [['sian-mamel', 'sian-femel'], ['besaantie', 'moorse-afgodt'], ['paradys', 'paradys-vischje']];
const ALL = PAIRS.flat();
const fail = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail.push(what); };

async function open(b, w, h, query, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  if (opts.route) await opts.route(page);
  await page.goto(`${ROOT}index.html?${query}`, { timeout: 180000 });
  await page.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
  return page;
}

// Runs in the page. Measures one pair over crossings, in simulated time.
const MEASURE = ({ speed, crossings }) => {
  const W = WATER, S = W.S, dt = 1 / 30, vp = () => S.vp;
  S.speed = S.speedTo = speed;
  const M = S.aspect;
  const proj = (m, x, y) => {
    const o = m.model, X = o[0] * x + o[4] * y + o[12], Y = o[1] * x + o[5] * y + o[13], Z = o[2] * x + o[6] * y + o[14], c = -Z;
    return [(vp()[0] * X) / c * M, (vp()[5] * Y) / c];     // in half window heights, so x and y are the same unit
  };
  const onScreen = (a, m) => {
    const e = a.f.extent; let x0 = 9e9, x1 = -9e9, y0 = 9e9, y1 = -9e9;
    for (const [x, y] of [[e[0], e[2]], [e[0], e[3]], [e[1], e[2]], [e[1], e[3]]]) {
      const p = proj(m, x, y); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return x1 > -M && x0 < M && y1 > -1 && y0 < 1;
  };
  const visible = (a, m) => onScreen(a, m) && W.opacity(-m.pos[2]) > .1;
  const showing = (a, m) => { const c = proj(m, 0, 0); return Math.abs(c[0]) < M && Math.abs(c[1]) < 1 && W.opacity(-m.pos[2]) > .35; };
  const body = (m) => { const a = proj(m, -.5, 0), b = proj(m, .5, 0); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const bodyBox = (a, m) => {   // the body itself on screen, without a long filament
    const e = a.f.extent; let x0 = 9e9, x1 = -9e9, y0 = 9e9, y1 = -9e9;
    for (const [x, y] of [[-.5, Math.max(e[2], -.6)], [-.5, Math.min(e[3], .6)], [.5, Math.max(e[2], -.6)], [.5, Math.min(e[3], .6)]]) {
      const p = proj(m, x, y); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1];
  };
  const out = { gap: [], heading: [], size: [], apart: [], order: [], late: [], t: { either: 0, both: 0, eitherShow: 0, bothShow: 0, stacked: 0, over: 0 }, swaps: 0, wob: [9, 0], waitSeen: 0, popsIn: 0, popsOut: 0, stops: 0, flips: 0, done: 0, kinds: {}, byKind: {}, alone: [], nopath: 0 };
  const seen = new Map(), crossed = new Set();
  // Every kind of route a pair can take. On its own a short catalog only ever gets the crossing keepCovered sends.
  const KINDS = ['cross', 'cross', 'cross', 'from-far', 'to-far'];
  let steps = 0, nextKind = 0;
  const maxSteps = 4e6;
  while (out.done < crossings && steps++ < maxSteps) {
    if (!S.active.length) {
      const party = S.ready.shift() || W.heldNext();
      if (party && !W.launch(party, { kind: KINDS[nextKind % 5] })) { out.nopath++; S.ready.unshift(party); } else if (party) nextKind++;
    }
    W.step(dt);
    const here = new Set();
    for (const a of S.active) {
      here.add(a);
      const m = W.modelOf(a), v = onScreen(a, m) ? W.opacity(-m.pos[2]) : 0;
      const q = seen.get(a);
      if (!q) { if (v > .02) out.popsIn++; seen.set(a, { v, x: m.pos[0], s: a.s, flip: m.flip }); }
      else {
        if (a.s > 0 && a.s <= q.s) out.stops++;
        if (m.flip !== q.flip) out.flips++;
        q.v = v; q.s = a.s;
      }
      if (a.s < 0 && v > .02) out.waitSeen++;
      if (a.pair) { out.wob[0] = Math.min(out.wob[0], a.wob); out.wob[1] = Math.max(out.wob[1], a.wob); out.kinds[a.kind] = out.kinds[a.kind] || new Set(); out.kinds[a.kind].add(a.pair); crossed.add(a.pair); }
      else out.alone.push(a.f.slug);
    }
    for (const [a, q] of seen) if (!here.has(a)) { if (q.v > .02) out.popsOut++; seen.delete(a); }
    for (const p of crossed) if (p.lead.gone && p.follow.gone) { out.done++; crossed.delete(p); }
    for (const p of S.pairs) {
      const { lead, follow } = p;
      const K = out.byKind[lead.kind] = out.byKind[lead.kind] || [0, 0];
      if (lead.gone || follow.gone) {
        const a = lead.gone ? follow : lead, m = W.modelOf(a);
        if (visible(a, m)) { out.t.either += dt; K[0] += dt; }
        if (showing(a, m)) out.t.eitherShow += dt;
        continue;
      }
      const ma = W.modelOf(lead), mb = W.modelOf(follow);
      const va = visible(lead, ma), vb = visible(follow, mb), sa = showing(lead, ma), sb = showing(follow, mb);
      if (va || vb) { out.t.either += dt; K[0] += dt; }
      if (sa || sb) out.t.eitherShow += dt;
      if (sa && sb) out.t.bothShow += dt;
      if (!(va && vb)) continue;
      out.t.both += dt; K[1] += dt;
      const ca = proj(ma, 0, 0), cb = proj(mb, 0, 0), ba = body(ma), bb = body(mb), mean = (ba + bb) / 2;
      const gap = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) / mean;
      if (gap < .5) out.t.stacked += dt;
      const ta = W.dbez(lead.path.p, W.posAt(lead, lead.s).u), tb = W.dbez(follow.path.p, W.posAt(follow, Math.max(0, follow.s)).u);
      let dh = Math.abs(Math.atan2(ta[2], ta[0]) - Math.atan2(tb[2], tb[0]));
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      // Do the bodies lie over each other on screen, and if so, are they clearly one in front of the other?
      const A = bodyBox(lead, ma), B = bodyBox(follow, mb);
      const over = A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
      const n = [Math.sin(ma.yaw), 0, Math.cos(ma.yaw)];
      const perp = ((ma.pos[0] - mb.pos[0]) * n[0] + (ma.pos[2] - mb.pos[2]) * n[2]) / p.L;
      if (over) {
        out.t.over += dt;
        out.apart.push(Math.abs(perp));
        const nearer = Math.sign(perp);
        if (p.was && nearer !== p.was) out.swaps++;
        p.was = nearer;
      }
      if (steps % 3 === 0) {
        out.gap.push(gap);
        out.heading.push(dh * 180 / Math.PI);
        // size that does not depend on heading: length over distance
        const ra = (lead.L / -ma.pos[2]) / (follow.L / -mb.pos[2]);
        out.size.push(Math.max(ra, 1 / ra));
        const dir = Math.sign(lead.path.table[60].p[0] - lead.path.table[0].p[0]);
        out.order.push((ma.pos[0] - mb.pos[0]) * dir / p.L);     // along the way they are going: above zero, the leader is ahead
        out.late.push(Math.abs(W.placeBehind(p) - follow.s) / p.L);
      }
    }
  }
  const q = (arr, f) => { const s = Float64Array.from(arr).sort(); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(3) : null; };
  const tri = a => [q(a, 0), q(a, .5), q(a, .995), q(a, 1)];
  return {
    crossings: out.done, simMinutes: +(steps * dt / 60).toFixed(0), aspect: +S.aspect.toFixed(2),
    gapBL: tri(out.gap), headingDeg: tri(out.heading), sizeRatio: tri(out.size), apartBL: tri(out.apart), overPct: +(100 * out.t.over / Math.max(out.t.both, 1e-6)).toFixed(1), byKind: Object.fromEntries(Object.entries(out.byKind).map(([k, v]) => [k, +(100 * v[1] / Math.max(v[0], 1e-6)).toFixed(0)])), nopath: out.nopath, aheadBL: tri(out.order), offPlaceBL: tri(out.late),
    bothVisiblePct: +(100 * out.t.both / Math.max(out.t.either, 1e-6)).toFixed(1), bothShowingPct: +(100 * out.t.bothShow / Math.max(out.t.eitherShow, 1e-6)).toFixed(1),
    stackedPct: +(100 * out.t.stacked / Math.max(out.t.both, 1e-6)).toFixed(2), depthSwaps: out.swaps,
    pace: out.wob.map(v => +v.toFixed(3)), waitSeen: out.waitSeen, popsIn: out.popsIn, popsOut: out.popsOut, stops: out.stops, flips: out.flips,
    alone: [...new Set(out.alone)], kinds: Object.fromEntries(Object.entries(out.kinds).map(([k, v]) => [k, v.size])),
  };
};

const NORMAL = ({ minutes, ALL, PAIRS }) => {
  const W = WATER, S = W.S, dt = 1 / 30, start = W.log.length;
  let maxActive = 0, maxShow = 0;
  for (let t = 0; t < minutes * 60; t += dt) {
    W.step(dt);
    maxActive = Math.max(maxActive, S.active.length);
    const show = S.active.filter(a => a.s < a.path.showTo).length;
    maxShow = Math.max(maxShow, show);
  }
  const ev = W.log.slice(start).filter(e => e.ev === 'spawn');
  const count = {}; for (const e of ev) count[e.slug] = (count[e.slug] || 0) + 1;
  const alone = ev.filter(e => ALL.includes(e.slug) && !e.pair).map(e => e.slug);
  const notPartner = ev.filter(e => e.pair && !PAIRS.some(p => p.includes(e.slug) && p.includes(e.pair))).map(e => e.slug);
  const stray = ev.filter(e => e.pair && !ALL.includes(e.slug)).map(e => e.slug);
  const nopath = W.log.filter(e => e.ev === 'nopath').map(e => e.slug);
  const others = Object.entries(count).filter(([s]) => !ALL.includes(s)).map(([, n]) => n);
  return {
    spawns: ev.length, maxActive, maxShow, alone, notPartner, stray, nopath, partnerCounts: PAIRS.map(p => p.map(s => count[s] || 0)),
    otherMin: Math.min(...others), otherMax: Math.max(...others), distinct: Object.keys(count).length,
  };
};

(async () => {
  const which = process.argv[2] || 'all';
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

  if (which === 'all' || which === 'pairs') {
    const n = +(process.argv[3] || 30);
    for (const [w, h] of [[1600, 900], [390, 844]]) for (const pair of PAIRS) for (const speed of [1, .1, 4]) {
      const p = await open(b, w, h, `manual=1&seed=${71 + speed * 10}&fish=${pair.join(',')}`);
      const r = await p.evaluate(MEASURE, { speed, crossings: n });
      console.log(`\n${w}x${h} ${pair.join(' + ')} at ${speed}x: ${r.crossings} crossings, ${r.simMinutes} simulated minutes, kinds ${JSON.stringify(r.kinds)}`);
      console.log(`  gap in body lengths, center to center on screen  min ${r.gapBL[0]}  median ${r.gapBL[1]}  99.5% ${r.gapBL[2]}  max ${r.gapBL[3]}`);
      console.log(`  both visible ${r.bothVisiblePct}% of the time either is, by kind of route ${JSON.stringify(r.byKind)}; both showing ${r.bothShowingPct}% of the time either is`);
      console.log(`  heading difference, degrees                      median ${r.headingDeg[1]}  99.5% ${r.headingDeg[2]}  max ${r.headingDeg[3]}`);
      console.log(`  on-screen size ratio, larger over smaller        median ${r.sizeRatio[1]}  99.5% ${r.sizeRatio[2]}  max ${r.sizeRatio[3]}`);
      console.log(`  bodies overlap on screen ${r.overPct}% of the shared time; then, front to back, body lengths  min ${r.apartBL[0]}  median ${r.apartBL[1]}; which is in front changed ${r.depthSwaps} times`);
      console.log(`  leader ahead along the way, body lengths         min ${r.aheadBL[0]}  median ${r.aheadBL[1]}  max ${r.aheadBL[3]}; centers within half a body length ${r.stackedPct}% of the time`);
      console.log(`  follower off its place, body lengths             median ${r.offPlaceBL[1]}  max ${r.offPlaceBL[3]}; pace ${r.pace[0]} to ${r.pace[1]}`);
      console.log(`  no route found on ${r.nopath} tries; traveled alone ${r.alone.length ? r.alone : 0}; seen while waiting at the start ${r.waitSeen}; pops in ${r.popsIn}, out ${r.popsOut}; stops ${r.stops}; turned round ${r.flips}`);
      check(!r.alone.length && !r.waitSeen && !r.popsIn && !r.popsOut && !r.stops && !r.flips && r.crossings >= n && !p.errs.length, `${pair[0]} ${speed}x ${w}x${h} rules held`);
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'normal') {
    for (const [w, h, seed] of [[1600, 900, 11], [1600, 900, 202], [390, 844, 11]]) {
      const p = await open(b, w, h, `manual=1&seed=${seed}`);
      const r = await p.evaluate(NORMAL, { minutes: 150, ALL, PAIRS });
      console.log(`\n${w}x${h} seed ${seed}, whole catalog, 150 simulated minutes:`, JSON.stringify(r));
      check(!r.alone.length && !r.notPartner.length && !r.stray.length, `${w}x${h} seed ${seed}: no pair member swam alone, ${r.alone.length}`);
      check(r.partnerCounts.every(([x, y]) => x === y && x > 0), `partners spawned equally: ${JSON.stringify(r.partnerCounts)}`);
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'real') {
    // Eviction, in the real loop at 4x, with more fish than the GPU holds.
    {
      const fish = [...ALL, 'bezaan', 'kamboton', 'joulong-joulong', 'sambilang', 'byenaneque', 'waboulang', 'macreel', 'imperator'].join(',');
      const p = await open(b, 1600, 900, `seed=5&fish=${fish}`);
      await p.keyboard.down('ArrowRight'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowRight');
      await p.evaluate(({ PAIRS }) => {
        const W = WATER, S = W.S, R = window.REC = { evicted: [], midSwim: [], half: [], dead: 0, maxHeld: 0, maxActive: 0, pairsSeen: new Set(), frames: 0 };
        const push = W.log.push.bind(W.log);
        W.log.push = e => {
          if (e.ev === 'evicted') {
            R.evicted.push(e.slug);
            if (S.active.some(a => a.f.slug === e.slug)) R.midSwim.push(e.slug);
          }
          return push(e);
        };
        const tick = () => {
          R.frames++;
          R.maxHeld = Math.max(R.maxHeld, W.fishes.length); R.maxActive = Math.max(R.maxActive, S.active.length);
          for (const a of S.active) {
            if (!W.gl.isTexture(a.f.color) || !W.fishes.includes(a.f)) R.dead++;
            if (a.pair) R.pairsSeen.add(a.f.slug);
            const mate = PAIRS.find(q => q.includes(a.f.slug));
            if (mate && !a.pair) R.half.push('alone ' + a.f.slug);
          }
          // Half held: one of a pair on the GPU, the other not, with neither out swimming or about to.
          for (const [x, y] of PAIRS) {
            const hx = W.fishes.some(f => f.slug === x), hy = W.fishes.some(f => f.slug === y);
            if (hx !== hy && S.ready.length && S.ready[0].some(f => f.slug === x || f.slug === y)) R.half.push('ready half ' + x);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { PAIRS });
      await p.waitForTimeout(150000);
      const r = await p.evaluate(() => { const R = window.REC; return { ...R, pairsSeen: [...R.pairsSeen], speed: WATER.S.speed, spawned: WATER.S.spawned }; });
      console.log(`\nreal loop at ${r.speed.toFixed(2)}x for 150 s: ${r.frames} frames, ${r.spawned} spawned, ${r.evicted.length} evictions, most held ${r.maxHeld}, most in water ${r.maxActive}`);
      // Evictions of pair members come two at a time
      const members = r.evicted.filter(s => ALL.includes(s));
      let paired = true;
      for (let i = 0; i < r.evicted.length; i++) {
        const q = PAIRS.find(x => x.includes(r.evicted[i]));
        if (q) { if (!q.includes(r.evicted[i + 1]) || r.evicted[i + 1] === r.evicted[i]) paired = false; i++; }
      }
      check(r.midSwim.length === 0, `nothing evicted mid-swim: ${r.midSwim.length}`);
      check(r.dead === 0, `no swimming fish drawn from deleted textures: ${r.dead}`);
      check(paired, `pair members leave the GPU together: ${members.length} member evictions, ${JSON.stringify(members)}`);
      check(r.half.length === 0, `nothing half held or alone: ${JSON.stringify(r.half.slice(0, 5))}`);
      check(r.pairsSeen.length >= 2, `pairs really were out: ${r.pairsSeen}`);
      check(!p.errs.length, `no page errors ${p.errs}`);
      await p.context().close();
    }
    // A partner that will not load, then one that never answers.
    for (const [name, handler, within] of [['fails', r => r.abort(), 6000], ['hangs', () => {}, 20000]]) {
      const route = page => page.route('**/assets/fish/sian-femel/**', handler);
      const t0 = Date.now();
      const p = await open(b, 1600, 900, 'seed=3&fish=sian-mamel,sian-femel', { route });
      await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 60000 });
      const ms = Date.now() - t0;
      const r = await p.evaluate(() => ({ active: WATER.S.active.map(a => [a.f.slug, !!a.pair]), spawned: WATER.S.spawned }));
      check(ms < within && r.active.length === 1 && r.active[0][0] === 'sian-mamel' && !r.active[0][1], `partner ${name}: the other swims alone after ${(ms / 1000).toFixed(1)} s, ${JSON.stringify(r.active)}`);
      await p.context().close();
    }
    // Query options, in the real loop.
    {
      let p = await open(b, 1600, 900, 'seed=3&fish=sian-mamel');
      await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 30000 });
      await p.waitForTimeout(4000);
      let r = await p.evaluate(() => ({ slugs: WATER.S.active.map(a => a.f.slug), pair: WATER.S.active.some(a => a.pair), held: WATER.fishes.map(f => f.slug) }));
      check(r.slugs.join() === 'sian-mamel' && !r.pair && r.held.join() === 'sian-mamel', `?fish=sian-mamel shows just that fish: ${JSON.stringify(r)}`);
      await p.context().close();

      p = await open(b, 1600, 900, 'seed=3&fish=sian-mamel,sian-femel');
      await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 30000 });
      r = await p.evaluate(() => ({ slugs: WATER.S.active.map(a => a.f.slug).sort(), pair: WATER.S.active.every(a => a.pair) }));
      check(r.slugs.join() === 'sian-femel,sian-mamel' && r.pair, `?fish=sian-mamel,sian-femel pairs them: ${JSON.stringify(r)}`);
      await p.context().close();

      for (const q of ['arrive=1&seed=3', 'arrive=1&seed=3&fish=sian-mamel,sian-femel']) {
        p = await open(b, 1600, 900, q);
        await p.waitForFunction('WATER.S.spawned === 1', null, { timeout: 60000 });
        await p.waitForFunction('WATER.S.stopped === true', null, { timeout: 180000, polling: 500 });
        r = await p.evaluate(() => ({ spawned: WATER.S.spawned, active: WATER.S.active.length, pair: WATER.log.some(e => e.pair) }));
        check(r.spawned === 1 && r.active === 0 && !r.pair, `?${q}: one fish, one crossing, then still: ${JSON.stringify(r)}`);
        await p.context().close();
      }

      p = await open(b, 1600, 900, 'seed=9&fish=sian-mamel,sian-femel', { reduced: true });
      await p.waitForFunction('WATER.S.active.length > 0', null, { timeout: 30000 });
      const a0 = await p.evaluate(() => WATER.S.active.map(a => ({ s: a.s, slug: a.f.slug, v: a.v, pair: !!a.pair })));
      await p.waitForTimeout(5000);
      const a1 = await p.evaluate(() => WATER.S.active.map(a => a.s));
      const moved = a0.map((a, i) => +((a1[i] - a.s) / 5).toFixed(4));
      check(a0.length === 2 && a0.every(a => a.pair && a.s > 0) && moved.every((m, i) => m > 0 && m < a0[i].v * .13), `reduced motion: pair starts in view, near still: moved ${moved} world/s, normal ${a0.map(a => a.v.toFixed(3))}`);
      await p.context().close();
    }
    // The real arrow keys on a real pair: hold to the top, hold to the floor, and read the gap every frame.
    {
      const p = await open(b, 1600, 900, 'seed=21&fish=sian-mamel,sian-femel');
      await p.waitForFunction('WATER.S.pairs.length > 0', null, { timeout: 30000 });
      await p.waitForTimeout(8000);
      await p.evaluate(() => {
        const R = window.GAP = { late: [], speed: 0 };
        const tick = () => {
          const q = WATER.S.pairs[0];
          if (q && !q.lead.gone && !q.follow.gone && q.follow.s > 0) { R.late.push(Math.abs(WATER.placeBehind(q) - q.follow.s) / q.L); R.speed = WATER.S.speed; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const read = () => p.evaluate(() => { const r = { max: Math.max(0, ...GAP.late), n: GAP.late.length, speed: GAP.speed }; GAP.late.length = 0; return r; });
      const r1 = await read();
      await p.keyboard.down('ArrowRight'); await p.waitForTimeout(5000); await p.keyboard.up('ArrowRight');
      await p.waitForTimeout(20000);
      const r2 = await read();
      await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(6000); await p.keyboard.up('ArrowLeft');
      await p.waitForTimeout(20000);
      const r3 = await read();
      console.log(`  real keys, follower off its place in body lengths: at 1x ${r1.max.toFixed(3)} (${r1.n} frames), up to 4x ${r2.max.toFixed(3)} (${r2.n}, ended ${r2.speed.toFixed(2)}x), down to 0.1x ${r3.max.toFixed(3)} (${r3.n}, ended ${r3.speed.toFixed(2)}x)`);
      check(Math.max(r2.max, r3.max) < .4 && !p.errs.length, 'arrow keys move the pair together');
      await p.context().close();
    }
  }
  await b.close();
  console.log(fail.length ? `\n${fail.length} FAILED:\n  ${fail.join('\n  ')}` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
