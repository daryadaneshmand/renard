#!/usr/bin/env node
// Schools: does each one arrive together and leave together, and does everything around them hold?
// Numbers only, and from simulated time except where it says real. Nothing here says how they look moving. NODE_PATH=<dir>/node_modules
//   node tools/school_check.cjs              all of it
//   node tools/school_check.cjs schools [n]  each school, n crossings, speeds 1, 0.1 and 4, two window shapes
//   node tools/school_check.cjs normal       the whole catalog: turns, sizes, never two at once, count of fish, window covered
//   node tools/school_check.cjs load         a school's print that fails, hangs or answers too late
//   node tools/school_check.cjs real         the real loop: eviction, query options, reduced motion, arrow keys
//   node tools/school_check.cjs fps          frame times with a school out, at the most fish seen at once
const { chromium } = require('playwright');
const ROOT = process.env.BENCH_ROOT || 'http://127.0.0.1:8918/';
const fail = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fail.push(what); };
const SLUGS = ['groot-half-beck', 'dorade-dauphin', 'eenhoorn', 'sambilang', 'vliegende-harder'];

async function open(b, w, h, query, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dpr || 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  if (opts.route) await opts.route(page);
  await page.goto(`${ROOT}index.html?${query}`, { timeout: 180000 });
  await page.waitForFunction('window.WATER_READY === true', null, { timeout: 180000 });
  return page;
}

// Runs in the page. One school over many crossings, in simulated time.
const MEASURE = ({ speed, crossings }) => {
  const W = WATER, S = W.S, dt = 1 / 30, M = S.aspect;
  S.speed = S.speedTo = speed;
  const proj = (m, x, y) => {
    const o = m.model, X = o[0] * x + o[4] * y + o[12], Y = o[1] * x + o[5] * y + o[13], Z = o[2] * x + o[6] * y + o[14], c = -Z;
    return [(S.vp[0] * X) / c * M, (S.vp[5] * Y) / c];     // in half window heights, so x and y are the same unit
  };
  const onScreen = (a, m) => {
    const e = a.f.extent; let x0 = 9e9, x1 = -9e9, y0 = 9e9, y1 = -9e9;
    for (const [x, y] of [[e[0], e[2]], [e[0], e[3]], [e[1], e[2]], [e[1], e[3]]]) {
      const p = proj(m, x, y); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return x1 > -M && x0 < M && y1 > -1 && y0 < 1;
  };
  const showing = (a, m) => { const c = proj(m, 0, 0); return Math.abs(c[0]) < M && Math.abs(c[1]) < 1 && W.opacity(-m.pos[2]) > .35; };
  // The body itself on screen, without long fins. Two of these lying mostly over each other is what reads as one fish doubled.
  const bodyBox = (a, m) => {
    const e = a.f.extent; let x0 = 9e9, x1 = -9e9, y0 = 9e9, y1 = -9e9;
    for (const [x, y] of [[-.5, Math.max(e[2], -.3)], [-.5, Math.min(e[3], .3)], [.5, Math.max(e[2], -.3)], [.5, Math.min(e[3], .3)]]) {
      const p = proj(m, x, y); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1];
  };
  const overShare = (A, B) => {
    const w = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), h = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min((A[2] - A[0]) * (A[3] - A[1]), (B[2] - B[0]) * (B[3] - B[1]));
  };
  const body = m => { const a = proj(m, -.5, 0), b = proj(m, .5, 0); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const out = { gap: [], heading: [], size: [], late: [], arrive: [], leave: [], span: [], share: [], sizes: {}, t: { any: 0, all: 0, half: 0, stacked: 0, doubled: 0, both: 0, inStep: 0, pairs: 0 }, wob: [9, 0], waitSeen: 0, popsIn: 0, popsOut: 0, stops: 0, flips: 0, done: 0, kinds: {}, alone: [], nopath: 0, count: {}, rate: [] };
  const seen = new Map(), track = new Map();
  const KINDS = ['cross', 'cross', 'cross', 'from-far', 'to-far'];
  let steps = 0, nextKind = 0, water = 0;
  while (out.done < crossings && steps++ < 4e6) {
    if (!S.active.length) {
      const party = S.ready.shift() || W.heldNext();
      if (party && !W.launch(party, { kind: KINDS[nextKind % 5] })) { out.nopath++; S.ready.unshift(party); } else if (party) nextKind++;
    }
    W.step(dt); water += dt * S.speed;
    const here = new Set();
    for (const a of S.active) {
      here.add(a);
      const m = W.modelOf(a), v = onScreen(a, m) ? W.opacity(-m.pos[2]) : 0;
      const q = seen.get(a);
      if (!q) { if (v > .02) out.popsIn++; seen.set(a, { v, s: a.s, flip: m.flip }); }
      else {
        if (a.s > 0 && a.s <= q.s) out.stops++;
        if (m.flip !== q.flip) out.flips++;
        q.v = v; q.s = a.s;
      }
      if (a.s < 0 && v > .02) out.waitSeen++;
      if (!a.party) out.alone.push(a.f.slug);
      else { out.wob[0] = Math.min(out.wob[0], a.wob); out.wob[1] = Math.max(out.wob[1], a.wob); }
    }
    for (const [a, q] of seen) if (!here.has(a)) { if (q.v > .02) out.popsOut++; seen.delete(a); }
    for (const p of S.parties) {
      const members = [p.lead, ...p.follows.map(m => m.fish)];
      if (!track.has(p)) { track.set(p, { first: new Map(), last: new Map() }); out.count[members.length] = (out.count[members.length] || 0) + 1; out.kinds[p.lead.kind] = (out.kinds[p.lead.kind] || 0) + 1; }
      const R = track.get(p);
      const live = members.filter(a => !a.gone).map(a => ({ a, m: W.modelOf(a) }));
      const show = live.filter(o => showing(o.a, o.m));
      for (const o of show) { if (!R.first.has(o.a)) R.first.set(o.a, water); R.last.set(o.a, water); }
      if (show.length) {
        out.t.any += dt;
        if (show.length === members.length) out.t.all += dt;
        if (show.length * 2 >= members.length) out.t.half += dt;
        if (steps % 3 === 0) out.share.push(show.length / members.length);
      }
      const vis = live.filter(o => onScreen(o.a, o.m) && W.opacity(-o.m.pos[2]) > .1);
      if (vis.length >= 2) {
        out.t.both += dt;
        let stacked = false, doubled = false;
        const sizeOf = o => o.a.L / -o.m.pos[2];
        let lo = 9e9, hi = 0;
        for (let i = 0; i < vis.length; i++) {
          lo = Math.min(lo, sizeOf(vis[i])); hi = Math.max(hi, sizeOf(vis[i]));
          for (let j = i + 1; j < vis.length; j++) {
            const ca = proj(vis[i].m, 0, 0), cb = proj(vis[j].m, 0, 0), mean = (body(vis[i].m) + body(vis[j].m)) / 2;
            const gap = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) / mean;
            if (gap < .5) stacked = true;
            if (overShare(bodyBox(vis[i].a, vis[i].m), bodyBox(vis[j].a, vis[j].m)) > .4) doubled = true;
            if (steps % 3 === 0) out.gap.push(gap);
            const dp = vis[i].a.phase - vis[j].a.phase;
            out.t.pairs += dt;
            if (Math.cos(dp) > Math.cos(.3)) out.t.inStep += dt;
          }
        }
        if (stacked) out.t.stacked += dt;
        if (doubled) out.t.doubled += dt;
        if (steps % 3 === 0) {
          out.size.push(hi / lo);
          const lm = live.find(o => o.a === p.lead);
          if (lm) for (const o of vis) if (o.a !== p.lead) {
            const ta = W.dbez(p.lead.path.p, W.posAt(p.lead, p.lead.s).u), tb = W.dbez(o.a.path.p, W.posAt(o.a, Math.max(0, o.a.s)).u);
            let dh = Math.abs(Math.atan2(ta[2], ta[0]) - Math.atan2(tb[2], tb[0]));
            if (dh > Math.PI) dh = 2 * Math.PI - dh;
            out.heading.push(dh * 180 / Math.PI);
          }
        }
      }
      if (!p.lead.gone && steps % 3 === 0) for (const m of p.follows) if (!m.fish.gone) out.late.push(Math.abs(W.placeBehind(p, m) - m.fish.s) / p.L);
      if (members.every(a => a.gone || a.s >= a.path.len)) p.finished = true;
    }
    for (const [p, R] of track) {
      if (S.parties.includes(p)) continue;
      out.done++;
      if (R.first.size) {
        const f = [...R.first.values()], l = [...R.last.values()];
        out.arrive.push(Math.max(...f) - Math.min(...f));
        out.leave.push(Math.max(...l) - Math.min(...l));
        out.span.push(Math.max(...l) - Math.min(...f));
        out.sizes[R.first.size] = (out.sizes[R.first.size] || 0) + 1;
      }
      track.delete(p);
    }
  }
  const q = (arr, f) => { const s = Float64Array.from(arr).sort(); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(3) : null; };
  const tri = a => [q(a, 0), q(a, .5), q(a, .995), q(a, 1)];
  const pct = (a, b) => +(100 * a / Math.max(b, 1e-6)).toFixed(1);
  return {
    crossings: out.done, simMinutes: +(steps * dt / 60).toFixed(0), aspect: +S.aspect.toFixed(2), counts: out.count, sawInWindow: out.sizes, kinds: out.kinds,
    arrive: tri(out.arrive), leave: tri(out.leave), span: tri(out.span),
    allPct: pct(out.t.all, out.t.any), halfPct: pct(out.t.half, out.t.any), stackedPct: pct(out.t.stacked, out.t.both), doubledPct: pct(out.t.doubled, out.t.both), inStepPct: pct(out.t.inStep, out.t.pairs),
    gap: tri(out.gap), heading: tri(out.heading), size: tri(out.size), late: tri(out.late), pace: out.wob.map(v => +v.toFixed(3)),
    nopath: out.nopath, alone: [...new Set(out.alone)], waitSeen: out.waitSeen, popsIn: out.popsIn, popsOut: out.popsOut, stops: out.stops, flips: out.flips,
    logNopath: W.log.filter(e => e.ev === 'nopath').length,
  };
};

// Runs in the page. The whole catalog as it really goes, in simulated time.
const NORMAL = ({ minutes, SCHOOLED }) => {
  const W = WATER, S = W.S, dt = 1 / 30, PAIRS = W.PAIRS.flat();
  let maxActive = 0, maxShow = 0, maxInWindow = 0, sum = 0, n = 0, twoSchools = 0, schoolPeak = 0, plainPeak = 0, gap = 0, gaps = 0, longest = 0, first = null, waitMax = 0, withSchool = 0;
  for (let t = 0; t < minutes * 60; t += dt) {
    W.step(dt);
    const active = S.active.length, school = S.parties.filter(p => p.school).length;
    maxActive = Math.max(maxActive, active); sum += active; n++;
    maxShow = Math.max(maxShow, S.active.filter(a => a.s < a.path.showTo).length);
    if (school > 1) twoSchools++;
    if (school) { schoolPeak = Math.max(schoolPeak, active); withSchool += dt; } else plainPeak = Math.max(plainPeak, active);
    let inside = 0;
    for (const a of S.active) {
      const m = W.modelOf(a), P = m.pos, d = -P[2];
      if (Math.abs(P[0]) < S.tanW * d && Math.abs(P[1]) < S.tanH * d && W.opacity(d) > .35) inside++;
    }
    maxInWindow = Math.max(maxInWindow, inside);
    if (inside && first === null) first = t;
    if (first !== null) { if (!inside) gap += dt; else if (gap) { gaps++; longest = Math.max(longest, gap); gap = 0; } }
  }
  const ev = W.log.filter(e => e.ev === 'spawn');
  const lone = ev.filter(e => SCHOOLED.includes(e.slug) && !e.school).map(e => e.slug);
  const stray = ev.filter(e => e.school && !SCHOOLED.includes(e.slug)).map(e => e.slug);
  const pairAlone = ev.filter(e => PAIRS.includes(e.slug) && !e.pair).map(e => e.slug);
  const crossed = {};
  for (const e of ev) if (e.school) {
    const c = crossed[e.slug] = crossed[e.slug] || { fish: 0, sizes: {} };
    c.fish++;
    c.sizes[e.school] = (c.sizes[e.school] || 0) + 1;
  }
  const turns = Object.fromEntries(Object.entries(crossed).map(([k, c]) => [k, Object.entries(c.sizes).map(([sz, fish]) => `${fish / sz} of ${sz}`).join(', ')]));
  const wanted = Object.fromEntries(SCHOOLED.map(s => [s, W.schoolSize(s)]));
  // Fewer than the full number is allowed when the window needs a school while the water is busy (SCHOOL.most), and never under 3.
  const under = Object.entries(crossed).flatMap(([k, c]) => Object.keys(c.sizes).filter(sz => +sz < Math.min(3, wanted[k])).map(sz => `${k} ${sz}`));
  const nopath = W.log.filter(e => e.ev === 'nopath').map(e => e.slug);
  return {
    spawns: ev.length, maxActive, maxShow, maxInWindow, meanAtOnce: +(sum / n).toFixed(2), schoolPeak, plainPeak, twoSchools, lone, stray, pairAlone, turns, wanted, under, nopath,
    gaps, longest: +longest.toFixed(2), withSchoolMin: +(withSchool / 60).toFixed(1),
  };
};

(async () => {
  const which = process.argv[2] || 'all';
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  console.log('testing', ROOT);

  if (which === 'all' || which === 'schools') {
    const n = +(process.argv[3] || 30);
    for (const [w, h] of [[1600, 900], [390, 844]]) for (const slug of SLUGS) for (const speed of [1, .1, 4]) {
      const p = await open(b, w, h, `manual=1&seed=${71 + speed * 10}&school=${slug}`);
      const r = await p.evaluate(MEASURE, { speed, crossings: n });
      const size = await p.evaluate(s => WATER.schoolSize(s), slug);
      console.log(`\n${w}x${h} ${slug} at ${speed}x, ${size} fish: ${r.crossings} crossings, ${r.simMinutes} simulated minutes, kinds ${JSON.stringify(r.kinds)}, launched sizes ${JSON.stringify(r.counts)}, how many ever showed ${JSON.stringify(r.sawInWindow)}`);
      console.log(`  water seconds, first in to last in     median ${r.arrive[1]}  max ${r.arrive[3]}; first out to last out  median ${r.leave[1]}  max ${r.leave[3]}; whole visit  median ${r.span[1]}`);
      console.log(`  all showing ${r.allPct}% of the time any is, at least half ${r.halfPct}%`);
      console.log(`  gap, body lengths, center to center    min ${r.gap[0]}  median ${r.gap[1]}  max ${r.gap[3]}; two centers within half a body ${r.stackedPct}% of shared time; two bodies mostly over each other ${r.doubledPct}%`);
      console.log(`  heading off the leader, degrees        median ${r.heading[1]}  max ${r.heading[3]}; size ratio largest over smallest  median ${r.size[1]}  max ${r.size[3]}`);
      console.log(`  follower off its place, body lengths   median ${r.late[1]}  max ${r.late[3]}; pace ${r.pace[0]} to ${r.pace[1]}; two tails within .3 rad of step ${r.inStepPct}% of the time (chance is about 9.5%)`);
      console.log(`  no route on ${r.nopath} tries, ${r.logNopath} logged; alone ${r.alone.length ? r.alone : 0}; seen while waiting ${r.waitSeen}; pops in ${r.popsIn}, out ${r.popsOut}; stops ${r.stops}; turned round ${r.flips}`);
      const sizes = Object.keys(r.counts).map(Number);
      check(!r.alone.length && !r.waitSeen && !r.popsIn && !r.popsOut && !r.stops && !r.flips && r.crossings >= n && !p.errs.length, `${slug} ${speed}x ${w}x${h} rules held`);
      check(sizes.length === 1 && sizes[0] === size, `${slug} ${speed}x ${w}x${h} every crossing the full ${size}: ${JSON.stringify(r.counts)}`);
      check(r.pace[0] >= .78 - 1e-6 && r.pace[1] <= 1.22 + 1e-6, `${slug} ${speed}x ${w}x${h} pace stays where coveredFor counts on it`);
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'normal') {
    for (const [w, h, seed] of [[1600, 900, 11], [1600, 900, 202], [390, 844, 11], [390, 844, 202]]) {
      const p = await open(b, w, h, `manual=1&seed=${seed}`);
      const r = await p.evaluate(NORMAL, { minutes: 150, SCHOOLED: SLUGS });
      console.log(`\n${w}x${h} seed ${seed}, whole catalog, 150 simulated minutes:`, JSON.stringify(r));
      check(!r.lone.length && !r.stray.length, `${w}x${h} seed ${seed}: school fish only ever in schools, and nobody else: ${r.lone.length} ${r.stray.length}`);
      check(!r.pairAlone.length, `pairs still pairs: ${r.pairAlone.length}`);
      check(!r.twoSchools, `never two schools at once: ${r.twoSchools}`);
      check(!r.under.length, `no school under 3: ${JSON.stringify(r.under)}; turns ${JSON.stringify(r.turns)}`);
      check(Object.keys(r.turns).length === SLUGS.length, `every school had turns: ${JSON.stringify(r.turns)}`);
      check(!r.gaps, `window never empty: ${r.gaps} gaps, longest ${r.longest}`);
      check(!p.errs.length, `no page errors ${p.errs}`);
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'load') {
    // A print that will not load, one with a single missing file, one that never answers, one that answers too late. Nobody half built.
    // Two orders, since it matters whether another fish is already out: seed 8 sends the school's turn first, seed 3 sends Bezaan first.
    for (const [seed, firstUp] of [[8, 'sambilang'], [3, 'bezaan']]) for (const [name, pattern, handler, wait] of [
      ['fails', '**/assets/fish/sambilang/**', r => r.abort(), 0],
      ['loses its mesh', '**/assets/fish/sambilang/mesh.bin', r => r.abort(), 0],
      ['hangs', '**/assets/fish/sambilang/**', () => {}, 12],
      ['hangs on one file', '**/assets/fish/sambilang/ink.webp', () => {}, 12],
      ['answers after the wait', '**/assets/fish/sambilang/**', r => { setTimeout(() => r.continue().catch(() => {}), 15000); }, 12],
    ]) {
      const route = page => page.route(pattern, handler);
      const t0 = Date.now();
      const p = await open(b, 1600, 900, `seed=${seed}&school=sambilang&fish=bezaan`, { route });
      await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 60000 });
      const ms = Date.now() - t0;
      const first = await p.evaluate(() => WATER.log.find(e => e.ev === 'spawn').slug);
      // Bezaan's next turn at top speed: the water goes on, and the school's print never swims.
      await p.keyboard.down('ArrowRight'); await p.waitForTimeout(4000); await p.keyboard.up('ArrowRight');
      await p.waitForFunction(`WATER.log.filter(e => e.ev === 'spawn').length >= 2`, null, { timeout: 150000, polling: 500 });
      const r = await p.evaluate(() => ({ spawns: WATER.log.filter(e => e.ev === 'spawn').map(e => e.slug), parties: WATER.S.parties.length, active: WATER.S.active.map(a => a.f.slug) }));
      const inTime = firstUp === 'sambilang' ? ms >= (wait - 1) * 1000 && ms < (wait + 8) * 1000 : ms < 8000;
      check(first === 'bezaan' && inTime && !r.parties && r.spawns.every(s => s === 'bezaan') && !p.errs.length, `seed ${seed}, ${firstUp} up first: school print ${name}: no school, the other fish swims, first after ${(ms / 1000).toFixed(1)} s, and again: ${JSON.stringify(r)}`);
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'real') {
    // Eviction, in the real loop at 4x, with more prints than the GPU holds.
    {
      const fish = ['bezaan', 'kamboton', 'joulong-joulong', 'byenaneque', 'waboulang', 'macreel', 'imperator', 'sian-mamel', 'sian-femel'].join(',');
      const p = await open(b, 1600, 900, `seed=5&school=groot-half-beck,sambilang,eenhoorn&fish=${fish}`);
      await p.keyboard.down('ArrowRight'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowRight');
      await p.evaluate(() => {
        const W = WATER, S = W.S, R = window.REC = { evicted: [], midSwim: [], dead: 0, maxHeld: 0, maxActive: 0, schools: {}, partial: [], frames: 0 };
        const push = W.log.push.bind(W.log);
        W.log.push = e => {
          if (e.ev === 'evicted') { R.evicted.push(e.slug); if (S.active.some(a => a.f.slug === e.slug)) R.midSwim.push(e.slug); }
          return push(e);
        };
        const tick = () => {
          R.frames++;
          R.maxHeld = Math.max(R.maxHeld, W.fishes.length); R.maxActive = Math.max(R.maxActive, S.active.length);
          for (const a of S.active) if (!W.gl.isTexture(a.f.color) || !W.fishes.includes(a.f)) R.dead++;
          for (const p of S.parties) if (p.school) (R.schools[p.lead.f.slug] = R.schools[p.lead.f.slug] || new Set()).add(p);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await p.waitForTimeout(150000);
      const r = await p.evaluate(() => { const R = window.REC; return { ...R, schools: Object.fromEntries(Object.entries(R.schools).map(([k, v]) => [k, v.size])), speed: WATER.S.speed, spawned: WATER.S.spawned }; });
      console.log(`\nreal loop at ${r.speed.toFixed(2)}x for 150 s: ${r.frames} frames, ${r.spawned} spawned, ${r.evicted.length} evictions, most held ${r.maxHeld}, most in water ${r.maxActive}, school crossings ${JSON.stringify(r.schools)}, evicted ${JSON.stringify(r.evicted)}`);
      check(r.midSwim.length === 0, `no print evicted while a member swims: ${r.midSwim.length}`);
      check(r.dead === 0, `no member drawn from deleted textures: ${r.dead}`);
      check(r.evicted.some(s => SLUGS.includes(s)), `school prints really were evicted between turns: ${r.evicted.filter(s => SLUGS.includes(s))}`);
      check(Object.keys(r.schools).length >= 2, `schools really were out: ${JSON.stringify(r.schools)}`);
      check(!p.errs.length, `no page errors ${p.errs}`);
      await p.context().close();
    }
    // Query options, in the real loop.
    {
      for (const slug of SLUGS) {
        const p = await open(b, 1600, 900, `seed=3&fish=${slug}`);
        await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 30000 });
        await p.waitForTimeout(4000);
        const r = await p.evaluate(() => ({ slugs: WATER.S.active.map(a => a.f.slug), party: WATER.S.active.some(a => a.party), spawned: WATER.S.spawned }));
        check(r.slugs.length === 1 && r.slugs[0] === slug && !r.party && r.spawned === 1, `?fish=${slug} shows one fish: ${JSON.stringify(r)}`);
        await p.context().close();
      }
      let p = await open(b, 1600, 900, 'seed=3&fish=groot-half-beck,bezaan');
      await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 30000 });
      await p.waitForTimeout(3000);
      let r = await p.evaluate(() => ({ slugs: WATER.S.active.map(a => a.f.slug), party: WATER.S.active.some(a => a.party) }));
      check(!r.party && r.slugs.length <= 2 && new Set(r.slugs).size === r.slugs.length, `?fish= list with a schooler in it never schools: ${JSON.stringify(r)}`);
      await p.context().close();

      for (const slug of SLUGS) {
        p = await open(b, 1600, 900, `seed=3&school=${slug}`);
        await p.waitForFunction('WATER.S.spawned > 0', null, { timeout: 30000 });
        r = await p.evaluate(s => ({ n: WATER.S.active.length, want: WATER.schoolSize(s), same: WATER.S.active.every(a => a.f.slug === s && a.f === WATER.S.active[0].f), parties: WATER.S.parties.length, held: WATER.fishes.length }), slug);
        check(r.n === r.want && r.same && r.parties === 1 && r.held === 1, `?school=${slug}: one school from one print: ${JSON.stringify(r)}`);
        await p.context().close();
      }

      for (const q of ['arrive=1&seed=3', 'arrive=1&seed=3&school=groot-half-beck', 'arrive=1&seed=3&fish=groot-half-beck']) {
        p = await open(b, 1600, 900, q);
        await p.waitForFunction('WATER.S.spawned === 1', null, { timeout: 60000 });
        await p.waitForFunction('WATER.S.stopped === true', null, { timeout: 180000, polling: 500 });
        r = await p.evaluate(() => ({ spawned: WATER.S.spawned, active: WATER.S.active.length, party: WATER.log.some(e => e.pair || e.school) }));
        check(r.spawned === 1 && r.active === 0 && !r.party, `?${q}: one fish, one crossing, then still: ${JSON.stringify(r)}`);
        await p.context().close();
      }

      for (const slug of ['groot-half-beck', 'dorade-dauphin']) {
        p = await open(b, 1600, 900, `seed=9&school=${slug}`, { reduced: true });
        await p.waitForFunction('WATER.S.active.length > 0', null, { timeout: 30000 });
        const a0 = await p.evaluate(() => WATER.S.active.map(a => ({ s: a.s, v: a.v, slug: a.f.slug, phase: a.phase })));
        await p.waitForTimeout(5000);
        const a1 = await p.evaluate(() => WATER.S.active.map(a => ({ s: a.s, phase: a.phase })));
        const moved = a0.map((a, i) => +((a1[i].s - a.s) / 5).toFixed(4));
        check(a0.length > 1 && a0.every(a => a.slug === slug) && moved.every((m, i) => m > 0 && m < a0[i].v * .13) && a1.length === a0.length, `reduced motion: ${slug} starts in view, near still: moved ${moved} world/s, normal ${a0[0].v.toFixed(3)}`);
        await p.context().close();
      }
    }
    // The real arrow keys on a real school: hold to the top, hold to the floor, read how far off its place anyone gets, every frame.
    {
      const p = await open(b, 1600, 900, 'seed=21&school=groot-half-beck');
      await p.waitForFunction('WATER.S.parties.length > 0', null, { timeout: 30000 });
      await p.waitForTimeout(8000);
      await p.evaluate(() => {
        const R = window.GAP = { late: [], speed: 0 };
        const tick = () => {
          const q = WATER.S.parties[0];
          if (q && !q.lead.gone) for (const m of q.follows) if (!m.fish.gone && m.fish.s > 0) { R.late.push(Math.abs(WATER.placeBehind(q, m) - m.fish.s) / q.L); R.speed = WATER.S.speed; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await p.waitForTimeout(8000);
      const read = () => p.evaluate(() => { const r = { max: Math.max(0, ...GAP.late), n: GAP.late.length, speed: GAP.speed }; GAP.late.length = 0; return r; });
      const r1 = await read();
      await p.keyboard.down('ArrowRight'); await p.waitForTimeout(5000); await p.keyboard.up('ArrowRight');
      await p.waitForTimeout(10000);
      const r2 = await read();
      await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(6000); await p.keyboard.up('ArrowLeft');
      await p.waitForTimeout(20000);
      const r3 = await read();
      console.log(`  real keys, follower off its place in body lengths: at 1x ${r1.max.toFixed(3)} (${r1.n} readings), up to 4x ${r2.max.toFixed(3)} (${r2.n}, ended ${r2.speed.toFixed(2)}x), down to 0.1x ${r3.max.toFixed(3)} (${r3.n}, ended ${r3.speed.toFixed(2)}x)`);
      check(Math.max(r1.max, r2.max, r3.max) < .6 && !p.errs.length, 'arrow keys move the school together');
      await p.context().close();
    }
  }

  if (which === 'all' || which === 'fps') {
    // Busier than the water gets by itself: a whole school and three more fish, all mid-route, in the browser's own frame loop.
    for (const [w, h, dpr] of [[1600, 900, 1], [1600, 900, 2], [390, 844, 3]]) {
      const p = await open(b, w, h, 'manual=1&seed=21&school=groot-half-beck&fish=bezaan,kamboton,joulong-joulong', { dpr });
      const r = await p.evaluate(async () => {
        const W = WATER, S = W.S;
        const f = W.fishes.find(x => x.slug === 'groot-half-beck');
        W.launch(Array(S.aspect < 1.2 ? 3 : 5).fill(f), { kind: 'cross', near: [5, 6.5] });
        const q = S.parties[0];
        q.lead.s = q.lead.path.len * .5;
        for (const m of q.follows) m.fish.s = W.placeBehind(q, m);
        for (const x of W.fishes) if (x !== f) { const a = W.spawn(x, { kind: 'cross' }); if (a) a.s = a.path.len * .5; }
        S.nextSpawn = 1e9;
        const n = S.active.length, got = [], px = new Uint8Array(4), work = [];
        // Headless frames can look perfect while the GPU falls behind, so the work of one frame is timed too, waiting for the GPU to finish it.
        for (let i = 0; i < 120; i++) { W.step(1 / 60); const t0 = performance.now(); W.render(); W.gl.readPixels(0, 0, 1, 1, W.gl.RGBA, W.gl.UNSIGNED_BYTE, px); work.push(performance.now() - t0); }
        work.sort((x, y) => x - y);
        await new Promise(res => {
          let last = performance.now();
          const tick = now => { got.push(now - last); last = now; W.step(1 / 60); W.render(); if (got.length < 400) requestAnimationFrame(tick); else res(); };
          requestAnimationFrame(tick);
        });
        got.shift(); got.sort((x, y) => x - y);
        return { n, frames: got.length, median: +got[got.length >> 1].toFixed(1), p95: +got[(got.length * .95) | 0].toFixed(1), p99: +got[(got.length * .99) | 0].toFixed(1), max: +got[got.length - 1].toFixed(1), over20: got.filter(v => v > 20).length, canvas: [W.canvas.width, W.canvas.height], work: [+work[60].toFixed(1), +work[114].toFixed(1), +work[119].toFixed(1)] };
      });
      console.log(`${w}x${h} dpr ${dpr}, ${r.n} fish, canvas ${r.canvas}: ${r.frames} frames, median ${r.median} ms, p95 ${r.p95}, p99 ${r.p99}, max ${r.max}, over 20 ms: ${r.over20}; one frame's work with the GPU waited on, median ${r.work[0]} ms, p95 ${r.work[1]}, max ${r.work[2]}`);
      check(r.median < 18 && r.work[1] < 16 && !p.errs.length, `${w}x${h} dpr ${dpr} holds 60 fps at ${r.n} fish: median ${r.median} ms`);
      await p.context().close();
    }
    // And the real thing: whole catalog, the page's own loop for a minute, new fish loading as they do, opening on a school.
    // Which seed opens on one depends on the catalog, so the page is asked: the first seed from 202 on whose school is among the
    // first two turns, which both set off within seconds. A school can also come later, so it is waited for as before.
    {
      let p = null, seed = 202;
      for (; seed < 202 + 80; seed++) {
        p = await open(b, 1600, 900, `seed=${seed}`);
        const opens = await p.waitForFunction('WATER.S.parties.some(q => q.school) || WATER.S.parties.length + WATER.S.active.filter(a => !a.party).length >= 2', null, { timeout: 30000 })
          .then(() => p.evaluate(() => WATER.S.parties.some(q => q.school)), () => false);
        if (opens) break;
        await p.context().close(); p = null;
      }
      check(!!p, `a seed from 202 opens on a school: ${p ? seed : 'none in 80'}`);
      if (!p) { await b.close(); console.log(`\n${fail.length} FAILED`); process.exit(1); }
      console.log(`  seed ${seed} opens on a school`);
      await p.waitForFunction('WATER.S.parties.some(q => q.school)', null, { timeout: 60000 });
      await p.evaluate(() => { window.BUSY = []; const tick = () => { BUSY.push(WATER.S.active.length); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      await p.waitForTimeout(60000);
      const r = await p.evaluate(() => { const f = WATER.frames.slice(-600).sort((x, y) => x - y); return { n: f.length, median: +f[f.length >> 1].toFixed(1), p95: +f[(f.length * .95) | 0].toFixed(1), max: +f[f.length - 1].toFixed(1), over20: f.filter(v => v > 20).length, most: Math.max(...BUSY) }; });
      console.log(`real loop, whole catalog, last ${r.n} frames of a minute that opened on a school, up to ${r.most} fish: median ${r.median} ms, p95 ${r.p95}, max ${r.max}, over 20 ms: ${r.over20}`);
      check(r.median < 18 && !p.errs.length, `real loop holds 60 fps: median ${r.median} ms`);
      await p.context().close();
    }
  }
  await b.close();
  console.log(fail.length ? `\n${fail.length} FAILED:\n  ${fail.join('\n  ')}` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
