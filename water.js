// Open water. Fish come from beyond the window and go beyond it, each along one long path.
// There are no walls: nothing here knows where the window is except the test that a path
// begins and ends where the fish cannot be seen.
import { makeProgram, loadFish, drawFish, setSwim, perspective, fishModel } from './rig.js';

const BASE = 'assets/fish';
const TAU = Math.PI * 2;
const D_MIN = 3.4;          // closest a fish comes
const D_CROSS = 9.5;        // farthest a side-to-side crossing runs
const D_GONE = 12.5;        // by here haze has taken a fish completely
const MAX_YAW = 47 * Math.PI / 180;   // off the plate's own view: past this the flat print shows
const SIDE_ON = 8 * Math.PI / 180;    // under this the swim barely reads

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const haze = d => Math.pow(clamp((d - 4) / (D_GONE - 4), 0, 1), 1.25);
const opacity = d => 1 - smooth(.72, .985, haze(d));

function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the water's lines
const QUAD_VS = `#version 300 es
out vec2 v; void main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const LINES_FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform float u_t, u_weight, u_aspect, u_scale;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// One family of burin lines. They run long and slightly slack, swell and thin, and lift off entirely
// in the lit places, so no line ever spans the window and nothing reads as a level or a horizon.
float family(vec2 p, float f, float tilt, float seed, float wmax, float t) {
  float c = cos(tilt), s = sin(tilt);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + seed;
  float y = q.y + 0.09 * (vn(vec2(q.x * 0.8, q.y * 0.5 + t * 0.012) + seed) - 0.5)
                + 0.022 * (vn(vec2(q.x * 3.1 - t * 0.02, q.y * 2.0) + seed * 2.0) - 0.5);
  float l = y * f + t * 0.02;
  float idx = floor(l);
  float dist = abs(fract(l) - 0.5);
  // light moves through slowly, at a size much larger than any line
  float light = vn(p * 0.9 + vec2(t * 0.011, -t * 0.007) + seed * 3.0) * 0.65 + vn(p * 2.3 - vec2(t * 0.009, t * 0.013) + seed) * 0.35;
  // along one line, its own stroke pattern
  float stroke = vn(vec2(q.x * (2.2 + 1.3 * hash(vec2(idx, seed))) + hash(vec2(seed, idx)) * 91.0, t * 0.017 + idx * 0.13));
  float open_ = smoothstep(0.34, 0.60, vn(p * 0.62 + vec2(-t * 0.006, t * 0.004) + seed * 0.3 + 11.0));
  float w = wmax * open_ * smoothstep(0.52, 0.88, stroke * 0.42 + (1.0 - light) * 0.86);
  float aa = fwidth(l) * 0.8;
  return 1.0 - smoothstep(w - aa, w + aa, dist);
}
void main() {
  vec2 p = v * vec2(u_aspect, 1.0);
  if (u_aspect < 1.0) p = v * vec2(1.0, 1.0 / u_aspect);
  p *= u_scale;   // on few pixels, fewer lines: they must stay lines
  float t = u_t;
  float cov = 0.0;
  cov = max(cov, 0.34 * family(p, 58.0, 0.03, 3.1, 0.15 * u_weight, t * 0.7));   // fine and far
  cov = max(cov, 0.58 * family(p, 31.0, -0.05, 7.7, 0.12 * u_weight, t));
  cov = max(cov, 1.00 * family(p, 13.0, 0.075, 1.9, 0.055 * u_weight, t * 1.3)); // few and near
  o = vec4(cov, 0.0, 0.0, 1.0);
}`;
const GROUND_FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D u_lines; uniform vec3 u_ground, u_line; uniform float u_strength;
void main() { o = vec4(mix(u_ground, u_line, texture(u_lines, v * 0.5 + 0.5).r * u_strength), 1.0); }`;

function program(gl, vs, fs) {
  const mk = (t, src) => {
    const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(pr, i).name; u[name] = gl.getUniformLocation(pr, name);
  }
  return { pr, u };
}

export async function start(canvas, LOOK, q) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: q.has('manual'), powerPreference: 'high-performance' });
  if (!gl) return;
  const P = makeProgram(gl);
  const pLines = program(gl, QUAD_VS, LINES_FS);
  const pGround = program(gl, QUAD_VS, GROUND_FS);
  const emptyVao = gl.createVertexArray();
  const fbo = gl.createFramebuffer();
  const lineTex = gl.createTexture();
  let lineW = 0, lineH = 0;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const seed = q.has('seed') ? +q.get('seed') : (Math.random() * 1e9) | 0;
  const R = rng(seed);
  const ARRIVE = q.has('arrive');
  const MANUAL = q.has('manual');

  const S = { waterRate: reduced.matches ? .05 * LOOK.lineMotion : LOOK.lineMotion, t: 0, waterT: 37, look: 0, lookTo: 0, active: [], bag: [], nextSpawn: .4, spawned: 0, doneArrive: false, stopped: false, tanH: 0, tanW: 0, aspect: 1 };
  const index = await (await fetch(`${BASE}/index.json`)).json();
  const fishes = [];
  const log = [];

  // ---- camera. Landscape keeps its height, a phone keeps its width: fish stay in proportion to the narrow side.
  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr) || 1, h = Math.round(canvas.clientHeight * dpr) || 1;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    S.aspect = w / h;
    S.tanH = S.aspect < 1.2 ? Math.tan(15 * Math.PI / 180) / S.aspect : Math.tan(17.5 * Math.PI / 180);
    S.tanW = S.tanH * S.aspect;
    const k = Math.min(1, 2200 / w);
    const lw = Math.round(w * k), lh = Math.round(h * k);
    if (lw !== lineW || lh !== lineH) {
      lineW = lw; lineH = lh;
      gl.bindTexture(gl.TEXTURE_2D, lineTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lineTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    S.vp = perspective(2 * Math.atan(S.tanH), S.aspect, .5, 60);
  }
  addEventListener('resize', layout);
  layout();

  // ---- how big a fish is in the water has nothing to do with how big it was printed
  function prepare(f) {
    const m = f.rig.mesh, cellArea = (m.cell / m.L) ** 2;
    const area = (m.body.idx / 6) * cellArea;           // silhouette, in body lengths squared
    f.worldL = clamp(.78 / Math.pow(area, .42), .62, 1.62);
    f.extent = f.rig.extent;
    const e = f.extent;
    f.radius = Math.max(...[[e[0], e[2]], [e[0], e[3]], [e[1], e[2]], [e[1], e[3]]].map(c => Math.hypot(c[0], c[1])));
    f.base = { ...f.swim };
    return f;
  }

  // ---- paths
  const bez = (p, u) => {
    const a = 1 - u, w = [a * a * a, 3 * a * a * u, 3 * a * u * u, u * u * u];
    return [0, 1, 2].map(i => w[0] * p[0][i] + w[1] * p[1][i] + w[2] * p[2][i] + w[3] * p[3][i]);
  };
  const dbez = (p, u) => {
    const a = 1 - u, w = [3 * a * a, 6 * a * u, 3 * u * u];
    return [0, 1, 2].map(i => w[0] * (p[1][i] - p[0][i]) + w[1] * (p[2][i] - p[1][i]) + w[2] * (p[3][i] - p[2][i]));
  };
  // World: camera at the origin, looking down -z. d = -z. Fish here are measured in world units.
  const hiddenAt = (P_, r) => {
    const d = -P_[2];
    if (opacity(d) < .004) return true;
    return Math.abs(P_[0]) - r > S.tanW * d || Math.abs(P_[1]) - r > S.tanH * d;
  };
  function yawOf(tan) {           // heading to the fish's own yaw and mirror
    const flip = tan[0] >= 0 ? -1 : 1;     // plate fish face -x; heading +x needs the mirror
    const yaw = Math.atan2(tan[2] * flip, Math.abs(tan[0]));
    return { flip, yaw };
  }
  function apparent(pos, yaw) {   // angle between the print's face and the line to the camera
    const n = [Math.sin(yaw), 0, Math.cos(yaw)];
    const l = Math.hypot(pos[0], pos[1], pos[2]);
    return Math.acos(clamp((-pos[0] * n[0] - pos[1] * n[1] - pos[2] * n[2]) / l, -1, 1));
  }
  function validate(p, f, r, speed) {
    if (!hiddenAt(p[0], r) || !hiddenAt(p[3], r)) return null;
    const N = 60;
    let vis = 0, sideOn = 0, len = 0, prev = bez(p, 0);
    const table = [{ u: 0, s: 0, p: prev }];
    const sign = Math.sign(dbez(p, 0)[0]);
    for (let i = 1; i <= N; i++) {
      const u = i / N, c = bez(p, u), tan = dbez(p, u);
      const lt = Math.hypot(tan[0], tan[1], tan[2]);
      if (Math.sign(tan[0]) !== sign) return null;                      // never doubles back
      if (Math.abs(tan[0]) / lt < Math.cos(MAX_YAW)) return null;       // never turns the flat print toward us
      if (Math.abs(tan[1]) / lt > .16) return null;                     // no climbing or diving
      const d = -c[2];
      if (d < D_MIN || d > D_GONE + 4) return null;
      const seen = !hiddenAt(c, r) && opacity(d) > .12;
      if (seen) {
        const { yaw } = yawOf(tan);
        const ap = apparent(c, yaw);
        if (ap > 53 * Math.PI / 180) return null;
        vis++;
        if (ap < SIDE_ON) sideOn++;
      }
      len += Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]);
      table.push({ u, s: len, p: c });
      prev = c;
    }
    if (vis < 6) return null;
    if (sideOn / vis > .25) return null;       // most of the time it must not be dead side-on
    return { p, table, len };
  }
  function candidate(f, r, kind, near) {
    const dir = R() < .5 ? 1 : -1;
    const dr = (a, b) => a + (b - a) * R();
    const side = d => S.tanW * d + r * 1.02 + .25;
    const yAt = (d, a = .78) => dr(-a, a) * S.tanH * d;
    let a, b;
    if (kind === 'cross') {
      const lo = near ? near[0] : D_MIN + .3, hi = near ? near[1] : D_CROSS;
      let d0 = dr(lo, hi), d1 = dr(lo, hi);
      // a crossing must carry real depth change, or it runs dead side-on
      if (Math.abs(d1 - d0) < .9) d1 = clamp(d0 + (d0 > (lo + hi) / 2 ? -1 : 1) * dr(1.2, 3), lo, hi);
      a = [-dir * side(d0), yAt(d0), -d0];
      b = [dir * side(d1), yAt(d1), -d1];
    } else {
      const dFar = D_GONE + dr(.3, 2), dSide = dr(D_MIN + .6, 8);
      const xFar = dr(-.2, .95) * S.tanW * dFar;
      const farP = [-dir * xFar, yAt(dFar, .5), -dFar];
      const sideP = [dir * side(dSide), yAt(dSide), -dSide];
      [a, b] = kind === 'from-far' ? [farP, sideP] : [sideP, farP];
      if (kind === 'to-far') { a = [-a[0], a[1], a[2]]; b = [-b[0], b[1], b[2]]; }
    }
    const mid = t => a.map((v, i) => v + (b[i] - v) * t);
    const j = i => [dr(-.5, .5), dr(-.35, .35), dr(-.8, .8)][i];
    const c1 = mid(.33).map((v, i) => v + j(i));
    const c2 = mid(.67).map((v, i) => v + j(i));
    return validate([a, c1, c2, b], f, r);
  }
  function plan(f, opts = {}) {
    const L = f.worldL * (opts.scale || (.86 + .3 * R()));
    const r = f.radius * L * 1.06 + .05;
    for (let tries = 0; tries < 80; tries++) {
      const pick = R();
      const kind = opts.kind || (pick < .6 ? 'cross' : pick < .8 ? 'from-far' : 'to-far');
      const path = candidate(f, r, kind, opts.near);
      if (path) return { path, L, r, kind };
    }
    return null;
  }
  function speedOf(f, L) {   // a fish goes as far as its tail pushes it
    return L * f.base.tempo * f.base.wavelength * .42;
  }
  function posAt(fish, s) {
    const T = fish.path.table;
    let lo = fish.seg;
    while (lo < T.length - 2 && T[lo + 1].s < s) lo++;
    fish.seg = lo;
    const a = T[lo], b = T[lo + 1];
    const k = clamp((s - a.s) / (b.s - a.s), 0, 1);
    const u = a.u + (b.u - a.u) * k;
    return { pos: bez(fish.path.p, u), tan: dbez(fish.path.p, u), u };
  }

  function spawn(f, opts) {
    const pl = plan(f, opts);
    if (!pl) return null;
    const fish = {
      f, path: pl.path, L: pl.L, r: pl.r, kind: pl.kind, seg: 0, s: 0, born: S.t,
      phase: R() * TAU, sway: R() * TAU, sway2: R() * TAU,
      pace: opts && opts.fast || 1,
      v: speedOf(f, pl.L) * (opts && opts.fast || 1) * (.88 + .24 * R()),
      slow: .03 + .05 * R(), id: S.spawned++,
    };
    if (reduced.matches) fish.s = pl.path.len * (.3 + .4 * R());
    S.active.push(fish);
    log.push({ ev: 'spawn', id: fish.id, slug: f.slug, t: S.t, kind: pl.kind, L: pl.L, len: pl.path.len, v: fish.v });
    return fish;
  }
  function nextFish() {
    if (!S.bag.length) {
      S.bag = fishes.slice();
      for (let i = S.bag.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [S.bag[i], S.bag[j]] = [S.bag[j], S.bag[i]]; }
    }
    for (let i = 0; i < S.bag.length; i++) {
      if (!S.active.some(a => a.f === S.bag[i])) return S.bag.splice(i, 1)[0];
    }
    return null;
  }

  // ---- one step of the world. Nothing here depends on rendering.
  function step(dt) {
    S.t += dt;
    const rate = reduced.matches ? .05 : 1;
    const calm = (ARRIVE && S.doneArrive) ? 0 : 1;
    S.waterRate += (calm * rate * LOOK.lineMotion - S.waterRate) * clamp(dt * .9, 0, 1);
    S.waterT += dt * S.waterRate;
    S.look += (S.lookTo - S.look) * clamp(dt * 3.2, 0, 1);
    if (Math.abs(S.lookTo - S.look) < .002) S.look = S.lookTo;

    const maxFish = reduced.matches ? 2 : (S.aspect < 1.2 ? 2 : 3);
    if (!ARRIVE) {
      S.nextSpawn -= dt;
      if (S.nextSpawn <= 0 && fishes.length) {
        if (S.active.length < maxFish) {
          const f = nextFish();
          if (f) spawn(f, S.spawned === 0 ? { kind: 'cross' } : undefined);
        }
        // mostly a little while; sometimes the water is left alone
        S.nextSpawn = R() < .28 ? 34 + 26 * R() : 10 + 18 * R();
      }
    } else if (!S.spawned && fishes.length) {
      // one fish, near enough to see, at an unhurried pace, side to side
      spawn(fishes[0], { kind: 'cross', near: [D_MIN + .4, 6], fast: 1.15 });
    }

    for (const a of S.active) {
      const wob = reduced.matches ? 1 : 1 + .22 * Math.sin(S.t * a.slow * TAU + a.sway);
      const mot = reduced.matches ? .1 : 1;
      a.s += a.v * wob * mot * dt;
      a.phase += TAU * a.f.base.tempo * a.pace * wob * mot * dt;   // accumulated: pace changes never jump
    }
    for (let i = S.active.length - 1; i >= 0; i--) {
      const a = S.active[i];
      if (a.s >= a.path.len) {
        S.active.splice(i, 1);
        log.push({ ev: 'gone', id: a.id, slug: a.f.slug, t: S.t });
        if (ARRIVE) S.doneArrive = true;
      }
    }
  }

  // ---- drawing
  function modelOf(a) {
    const { pos, tan } = posAt(a, a.s);
    const { flip, yaw } = yawOf(tan);
    const lt = Math.hypot(tan[0], tan[2]);
    const pitch = clamp(tan[1] / lt, -.16, .16);
    const quiet = reduced.matches ? .1 : 1;
    // the whole body answers the tail a little
    const recoil = quiet * .018 * Math.sin(a.phase + 1.2);
    const roll = -pitch * flip * .9 + quiet * .012 * Math.sin(S.t * .23 + a.sway2);
    const model = fishModel(pos[0], pos[1], pos[2], a.L, yaw + recoil * flip, roll, flip);
    return { model, pos, yaw, flip };
  }
  function render() {
    // the lines, once, for the ground and for the veil over far fish
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, lineW, lineH);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(pLines.pr);
    gl.uniform1f(pLines.u.u_t, S.waterT);
    gl.uniform1f(pLines.u.u_weight, LOOK.lineWeight);
    gl.uniform1f(pLines.u.u_aspect, S.aspect);
    gl.uniform1f(pLines.u.u_scale, clamp(Math.min(lineW, lineH) / 2 / 450, .45, 1));
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pGround.pr);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lineTex);
    gl.uniform1i(pGround.u.u_lines, 2);
    gl.uniform3fv(pGround.u.u_ground, LOOK.ground);
    gl.uniform3fv(pGround.u.u_line, LOOK.line);
    gl.uniform1f(pGround.u.u_strength, LOOK.lineStrength);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(P.pr);
    gl.uniformMatrix4fv(P.u.u_vp, false, S.vp);
    gl.uniform3fv(P.u.u_paper, index.paper);
    gl.uniform3fv(P.u.u_inkc, index.ink);
    gl.uniform3fv(P.u.u_ground, LOOK.ground);
    gl.uniform3fv(P.u.u_linec, LOOK.line);
    gl.uniform2f(P.u.u_res, canvas.width, canvas.height);

    const order = S.active.map(a => ({ a, ...modelOf(a) })).sort((x, y) => x.pos[2] - y.pos[2]);
    for (const o of order) {
      const d = -o.pos[2], f = o.a.f;
      const op = opacity(d);
      if (op < .004) continue;
      f.phase = o.a.phase;
      f.swim = { ...f.base };
      if (reduced.matches) { f.swim.amplitude = f.base.amplitude * .5; f.swim.flap = 0; }
      const h = haze(d);
      drawFish(gl, P, f, o.model, S.look, h, { opacity: op, veil: LOOK.lineStrength * smooth(.08, .8, h) * .9 });
    }
  }

  // ---- loop
  const frames = [];
  let last = performance.now();
  function frame(now) {
    if (S.stopped) return;
    const dt = Math.min(.05, (now - last) / 1000);
    frames.push(now - last);
    if (frames.length > 600) frames.shift();
    last = now;
    step(dt);
    render();
    if (ARRIVE && S.doneArrive && S.waterRate < .002) {
      // empty, still, and asleep
      S.stopped = true;
      S.waterRate = 0;
      render();
      log.push({ ev: 'still', t: S.t });
      return;
    }
    requestAnimationFrame(frame);
  }

  addEventListener('keydown', e => { if (e.key === 'i' || e.key === 'I') S.lookTo = S.lookTo ? 0 : 1; });

  // ---- load one at a time; the water does not wait for all of them
  const maxTex = Math.min(innerWidth, innerHeight) < 600 ? 1024 : 2048;
  let slugs = index.fish.slice();
  for (let i = slugs.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [slugs[i], slugs[j]] = [slugs[j], slugs[i]]; }
  if (ARRIVE) slugs = [q.get('fish') || slugs[0]];
  else if (q.has('fish')) slugs = q.get('fish').split(',');
  const loaded = (async () => {
    for (const s of slugs) {
      const f = prepare(await loadFish(gl, BASE, s, { maxTex }));
      fishes.push(f);
      await new Promise(r => setTimeout(r, MANUAL ? 0 : 30));
    }
  })();

  // ---- the test seam: nothing the page uses
  const exposeReadback = () => {
    const T = makeProgram(gl, true);
    return (a) => {
      const { model } = modelOf(a);
      const f = a.f, m = f.body;
      f.phase = a.phase; f.swim = { ...f.base };
      gl.useProgram(T.pr);
      gl.uniformMatrix4fv(T.u.u_vp, false, S.vp);
      setSwim(gl, T, f);
      gl.uniformMatrix4fv(T.u.u_model, false, model);
      gl.uniform2f(T.u.u_hingeN, 0, 0);
      gl.uniform1f(T.u.u_flap, 0);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, m.verts * 16, gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
      gl.bindVertexArray(m.vao);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, m.verts);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindVertexArray(null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      const out = new Float32Array(m.verts * 4);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
      gl.deleteBuffer(buf);
      return out;
    };
  };
  window.WATER = {
    S, log, frames, fishes, step, render, loaded, seed, modelOf, spawn, plan, opacity, haze, apparent, yawOf, posAt, dbez, gl, LOOK, exposeReadback, canvas,
  };

  if (MANUAL) { await loaded; window.WATER_READY = true; return; }
  window.WATER_READY = true;
  requestAnimationFrame(t => { last = t; frame(t); });
}
