// Open water. Fish come from beyond the window and go beyond it, each along one long path.
// There are no walls: nothing here knows where the window is except the test that a path
// begins and ends where the fish cannot be seen.
import { makeProgram, loadFish, disposeFish, drawFish, setSwim, perspective, fishModel } from './rig.js';

const BASE = 'assets/fish';
const TAU = Math.PI * 2;
const D_MIN = 3.4;          // closest a fish comes
const D_CROSS = 9.5;        // farthest a side-to-side crossing runs
const D_GONE = 12.5;        // by here haze has taken a fish completely
const MAX_YAW = 47 * Math.PI / 180;   // off the plate's own view: past this the flat print shows
const SIDE_ON = 8 * Math.PI / 180;    // under this the swim barely reads
const READY = 1;            // fish loaded and waiting their turn
const HOLD = 6;             // fish on the GPU at once, swimming or not; the rest stay on the server
const SHOWING = .35;        // haze past this and a fish no longer counts as being there to look at
const COVER_MARGIN = 1.5;   // seconds of overlap asked for when one fish hands the window to the next
// Left and right arrows: everything in the water goes slower or faster together.
const SPEED = { min: .1, max: 4, tap: 1.25, hold: .9, ease: 3 };   // a tap multiplies by tap; holding multiplies by e^hold per second
const PACE = { min: .78, max: 1.22 };   // the fastest and slowest a fish goes against its own speed; coveredFor counts on this

// ================================================================================================
// COMPANIONS. Two different prints of one species, one bag turn, one route. Which fish go together
// comes from research/fish-natural-history.json: both the identity and the behavior had to hold.
// Ican Tomtombo and Tomtombo 40 are one species too and are left out on purpose: its sourced behavior is solitary.
const PAIRS = [
  // the number: how close this pair swims, against the distances in BUDDY. These two wrasse are long and slim, so a body length is a long way.
  ['sian-mamel', 'sian-femel', 1],         // Abudefduf vaigiensis, and his caption has them together
  ['besaantie', 'moorse-afgodt', 1],       // Zanclus cornutus, FishBase "generally 2 or 3"
  ['paradys', 'paradys-vischje', .7],      // Labroides dimidiatus, a pair of adults at a cleaning station
];
// How they swim together is a taste call and it is Darya's. Every number for it is here, the first five first to reach for.
// Lengths are in body lengths, so a close pair stays close at any size and depth.
const BUDDY = {
  trail: 1.0,         // how far back along the route the follower swims
  breathe: .22,       // the gap opens and closes by this much either way
  breatheEvery: 10,   // one slow breath per this many body lengths traveled
  up: .5,             // how far above or below the other it swims
  back: .4,           // how much nearer or farther. Enough that one clearly passes in front, little enough that sizes stay close
  // the finer points
  narrow: .7,         // in a tall, narrow window it trails by this share of trail, or it spends the crossing a window behind
  drift: .3,          // how much those two offsets change along the route, as a share: routes stay alike without being one line
  sizeSpread: .02,    // the two are this much bigger and smaller than their shared size
  sizeMax: 1.15,      // a route is turned down if the larger looks more than this many times the smaller, anywhere in view
  headingMax: 10,     // or if their headings part by more than this many degrees
  paceWander: .07,    // the leader's pace wanders by this much, against .22 for a fish alone, so the follower can keep up
  ownPace: .02,       // what the follower's pace wanders by on top of following
  keepUp: .3,         // per second of water time: how firmly the follower holds its place
  settle: 1.5,        // seconds of water time for the follower's pace to reach what it wants
  tailSplit: .05,     // one tail runs this much faster than its print's tempo and the other this much slower
  tailWander: .05,    // and each tail's rate wanders by this much on its own
};
const PARTNER_WAIT = 12;   // seconds after one of a pair has loaded that the window waits for the other, then it swims alone
// ================================================================================================
// SCHOOLS. Copies of one print, one bag turn, one route. A trial: she asked pairs to be "real buddies that wouldn't
// just be one copy of same print", and a species with one print can only school as copies of it. Her eye decides.
// Who is on this list comes from research/fish-natural-history.json, and a comment says how sound each one is.
const SCHOOLS = [
  // slug, how many swim together, how close: the last number is against the distances in SCHOOL, as in PAIRS.
  ['groot-half-beck', 5, 1],    // Hemiramphus far. Soundest kind: identity firm to species, and FishBase says it schools.
  ['dorade-dauphin', 3, 1.1],   // Coryphaena hippurus. Same: firm to species, FishBase says it schools. Open ocean and big, so few and wider apart.
  ['eenhoorn', 4, 1],           // Naso brevirostris. Firm to species, FishBase: large schools in oceanic places and on current-swept reefs, small groups otherwise.
  ['sambilang', 5, .8],         // Plotosus lineatus. Firm to species, but it depends on age: young in dense balls of about 100, adults about 20 or alone. Five does not claim the ball.
  ['vliegende-harder', 4, 1],   // A flyingfish. Softer: the identity is firm only to family, and "schools" is the page for Exocoetus volitans, where Bleeker's name for this figure now lands.
  // Left out, since the evidence does not reach. To try one anyway, remove its two slashes.
  // ['byenaneque', 4, 1],      // A goatfish, family only. "Many goatfish" school, but what is described is a daytime school at rest, and foraging alone or loosely. Nothing that travels.
  // ['carcasse', 3, 1],        // Canthigaster valentini, firm. The same page reports shoals of 10 to 100 and also says territorial and haremic, a fish that holds a place.
];
// How they swim together is a taste call and it is Darya's. The first group is the first to reach for.
// Lengths are in body lengths, so a school looks the same at any size and depth.
const SCHOOL = {
  scale: .72,         // each member is this much smaller than the same fish alone, or five long fish fill the window
  near: [4.6, 8.5],   // how near and far a side-to-side crossing runs, so the whole group fits in view
  row: .55,           // each member after the leader swims about this much farther back along the route, so a bigger school is a longer one
  level: 1.3,         // each member has its own level, this many body heights from the next one, so two lie over each other only in passing
  levelMin: .36,      // and at least this many body lengths, for slim fish
  deep: .65,          // how much nearer or farther
  breathe: .26,       // each member's place slides this far forward and back along the route, each on its own
  breatheEvery: 11,   // one slow breath per about this many body lengths traveled, different for each member
  company: 1,         // a school waits to set off until only this many other fish are in the water, and no company joins while it is out. The window staying covered comes first.
  most: 7,            // when the window needs a school sooner than that, it goes with fewer members rather than take the water past this many fish, and at least 3
  narrowCount: .6,    // in a tall, narrow window the school is this share of its number, and at least 3. With the numbers above, that is 3 for all of them
  narrow: .7,         // and its length along the route is this share of what row gives
  // the finer points
  drift: .3,          // how much a member's offsets change along its route, as a share of the room between levels: routes stay alike without being one line
  sizeSpread: .08,    // members run this much bigger and smaller than their shared size, evenly spread
  sizeMax: 1.4,       // a route is turned down if a member looks more than this many times the leader, or less, anywhere in view
  headingMax: 13,     // or if its heading parts from the leader's by more than this many degrees
  paceWander: .06,    // the leader's pace wanders by this much
  ownPace: .035,      // what each follower's pace wanders by on top of following
  keepUp: .3,         // per second of water time: how firmly a follower holds its place
  settle: 1.8,        // seconds of water time for a follower's pace to reach what it wants
  tailSplit: .09,     // the tails run this far either side of the print's tempo, evenly spread, so no two keep step
  tailWander: .06,    // and each tail's rate wanders by this much on its own
  ampSpread: .1,      // the tails beat this much wider or narrower, evenly spread
};
// ================================================================================================

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

  const S = { speed: 1, speedTo: 1, speedHeld: 0, parties: [], waterRate: reduced.matches ? .05 * LOOK.lineMotion : LOOK.lineMotion, t: 0, waterT: 37, look: 0, lookTo: 0, active: [], bag: [], ready: [], nextSpawn: .4, spawned: 0, doneArrive: false, stopped: false, tanH: 0, tanW: 0, aspect: 1 };
  const index = await (await fetch(`${BASE}/index.json`)).json();
  const fishes = [];
  const log = [];
  const PARTNER = new Map(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));
  // Who schools this visit. ?fish= is how to see one fish alone, so a list of fish never schools. ?arrive is one fish.
  const SCHOOLING = ARRIVE ? [] : q.has('school') ? q.get('school').split(',') : q.has('fish') ? [] : SCHOOLS.map(r => r[0]);

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
    let showFrom = Infinity, showTo = -1;
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
      // really there to look at: its middle inside the window, and not lost to haze
      if (Math.abs(c[0]) < S.tanW * d && Math.abs(c[1]) < S.tanH * d && opacity(d) > SHOWING) {
        showFrom = Math.min(showFrom, len);
        showTo = len;
      }
      table.push({ u, s: len, p: c });
      prev = c;
    }
    if (vis < 6) return null;
    if (sideOn / vis > .25) return null;       // most of the time it must not be dead side-on
    return { p, table, len, showFrom, showTo };
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
      if (path && (!opts.show || path.showTo > path.showFrom)) return { path, L, r, kind };
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
    const pl = opts && opts.pl || plan(f, opts);
    if (!pl) { log.push({ ev: 'nopath', slug: f.slug, t: S.t }); return null; }
    const fish = {
      f, path: pl.path, L: pl.L, r: pl.r, kind: pl.kind, seg: 0, s: 0, born: S.t,
      phase: R() * TAU, sway: R() * TAU, sway2: R() * TAU,
      pace: opts && (opts.pace || opts.fast) || 1,
      v: opts && opts.v || speedOf(f, pl.L) * (opts && opts.fast || 1) * (.88 + .24 * R()),
      slow: .03 + .05 * R(), id: S.spawned++,
    };
    if (reduced.matches) fish.s = pl.path.len * (.3 + .4 * R());
    S.active.push(fish);
    log.push({ ev: 'spawn', id: fish.id, slug: f.slug, t: S.t, kind: pl.kind, L: pl.L, len: pl.path.len, v: fish.v, pair: opts && opts.mate, school: opts && opts.school });
    return fish;
  }

  // ---- companions: a pair or a school. A follower's route is the leader's, moved a little, and it passes the same test as any path.
  // A pair goes on the two distances in BUDDY. A member of a school is given its own place in the group.
  function companionRoute(p, reach, r, place) {
    const mid = bez(p, .5), recedes = p[0][2] - p[3][2];
    // toward the middle of the window, or the second fish can spend the crossing past its top or bottom
    const off = Math.abs(mid[1]) > .2 * S.tanH * -mid[2];
    let up, upBy, back, backBy;
    if (place) {
      up = back = 1;
      upBy = place.up;
      // Its place is behind the leader, so on a route going away from us it would be nearer and bigger. Farther out by as much keeps them alike.
      backBy = place.back + place.along * recedes / Math.hypot(p[3][0] - p[0][0], p[3][2] - p[0][2]);
    } else {
      up = off ? -Math.sign(mid[1]) : R() < .5 ? 1 : -1;
      upBy = BUDDY.up;
      // On a route going away from us, the one behind is the nearer. Setting it farther out keeps the two the same size.
      back = Math.abs(recedes) > .3 ? Math.sign(recedes) : R() < .5 ? 1 : -1;
      backBy = BUDDY.back;
    }
    const some = v => place ? (v + place.sway * (2 * R() - 1)) * reach : v * reach * (1 + BUDDY.drift * (2 * R() - 1));
    return p.map((c, i) => {
      const q = [c[0], c[1] + up * some(upBy), c[2] - back * some(backBy)];
      if (i === 0 || i === 3) {
        // An end stays where this fish cannot be seen: out in the haze, or past the side. A longer fish
        // needs to go farther out, and it goes straight on along the route, so the two do not converge.
        if (-c[2] > D_GONE) q[2] = Math.min(q[2], -D_GONE - .1);
        else {
          const t = dbez(p, i ? 1 : 0), out = i ? 1 : -1;
          for (let k = 0; k < 3; k++) {
            const short = S.tanW * -q[2] + r * 1.02 + .25 - Math.abs(q[0]);
            if (short <= 0) break;
            const by = short / Math.abs(t[0]);
            q[0] += out * t[0] * by; q[1] += out * t[1] * by; q[2] += out * t[2] * by;
          }
        }
      }
      return q;
    });
  }
  // Same size and same heading all the way through the window, with the follower where it will be.
  function alike(lp, fp, trail, fL, lL, T) {
    for (const c of lp.table) {
      const d = -c.p[2];
      if (Math.abs(c.p[0]) > S.tanW * d || opacity(d) < SHOWING) continue;
      const s = sOnPath(fp, c.p[0]) - trail;
      if (s <= 0) continue;
      const q = onPath(fp, s), ratio = (lL / d) / (fL / -q.p[2]);
      if (Math.max(ratio, 1 / ratio) > T.sizeMax) return false;
      const a = dbez(lp.p, c.u), b = dbez(fp.p, q.u);
      let turn = Math.abs(Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
      if (turn > Math.PI) turn = TAU - turn;
      if (turn > T.headingMax * Math.PI / 180) return false;
    }
    return true;
  }
  const isSchool = party => party[0] === party[1];
  // Evenly spread a little either side of 1, in no order, so no two members match and nothing lines up with where they swim.
  const spread = (n, by) => shuffled(Array.from({ length: n }, (_, i) => 1 + by * ((2 * i + 1) / n - 1)));
  // Everyone's place in a school, against the leader. Each has its own level, in no order, and its own spot down the length,
  // shaken, so they make neither a line nor a grid and two of them come to lie over each other only in passing.
  function schoolPlaces(n, f, close, p) {
    const m = f.rig.mesh, height = 1.45 * (m.body.idx / 6) * (m.cell / m.L) ** 2;     // of the body, without long fins
    const room = Math.max(SCHOOL.level * height, SCHOOL.levelMin) / close;
    const levels = shuffled(Array.from({ length: n }, (_, i) => i));
    // Near the window's top or bottom the leader takes the outermost level, or the others spend the crossing past the edge.
    const mid = bez(p, .5);
    if (Math.abs(mid[1]) > .2 * S.tanH * -mid[2]) {
      const k = levels.indexOf(mid[1] > 0 ? n - 1 : 0);
      [levels[0], levels[k]] = [levels[k], levels[0]];
    }
    return levels.slice(1).map((v, i) => ({
      i, sway: SCHOOL.drift * room, narrow: SCHOOL.narrow,
      up: (v - levels[0] + .2 * (2 * R() - 1)) * room,
    }));
  }
  const inPlace = place => ({ ...place, along: SCHOOL.row * (place.i + .35 + .65 * R()), back: SCHOOL.deep * (2 * R() - 1) });
  // A pair's two prints, or a school's copies of one.
  function planParty(party, opts = {}) {
    const school = isSchool(party);
    const [lead, ...rest] = school ? party : R() < .5 ? party : [party[1], party[0]];
    const T = school ? SCHOOL : BUDDY;
    const close = school ? SCHOOLS.find(q => q[0] === lead.slug)[2] : PAIRS.find(q => q.includes(lead.slug))[2];
    // One species at about one distance: one size, whatever size each print would have had alone.
    const L = (lead.worldL + rest[0].worldL) / 2 * (opts.scale || (.86 + .3 * R())) * (school ? T.scale : 1);
    const sizes = school ? spread(party.length, T.sizeSpread) : [1 + T.sizeSpread, 1 - T.sizeSpread];
    const lL = L * sizes[0];
    const reach = L * close;
    const near = opts.near || (school ? T.near : undefined);
    let best = null;
    for (let tries = 0; tries < 30; tries++) {
      const pl = plan(lead, { ...opts, near, scale: lL / lead.worldL });
      if (!pl) continue;
      const follows = [], places = school ? schoolPlaces(party.length, lead, close, pl.path.p) : null;
      rest.forEach((follow, i) => {
        const fL = L * sizes[i + 1], fr = follow.radius * fL * 1.06 + .05;
        for (let k = 0; k < 8; k++) {
          const place = school ? inPlace(places[i]) : null;
          const path = validate(companionRoute(pl.path.p, reach, fr, place), follow, fr);
          const along = place || { along: BUDDY.trail, narrow: BUDDY.narrow };
          if (path && (!opts.show || path.showTo > path.showFrom) && alike(pl.path, path, reach * trailOf(along), fL, lL, T)) {
            follows.push({ path, L: fL, r: fr, kind: pl.kind, f: follow, ...along });
            break;
          }
        }
      });
      if (follows.length && (!best || follows.length > best.follows.length)) {
        best = {
          lead: { ...pl, f: lead }, follows, L, reach, school,
          v: (speedOf(lead, lL) + speedOf(rest[0], school ? lL : L * sizes[1])) / 2 * (.88 + .24 * R()),
        };
      }
      if (best && best.follows.length === rest.length) return best;
    }
    return school ? best : null;     // of a school, as many as found a route
  }
  // Along a route x only ever runs one way (validate holds it to that), so x says who has got how far.
  function onPath(path, s) {
    const T = path.table;
    let i = 1;
    while (i < T.length - 1 && T[i].s < s) i++;
    const a = T[i - 1], b = T[i], k = clamp((s - a.s) / (b.s - a.s), 0, 1);
    return { p: a.p.map((v, j) => v + (b.p[j] - v) * k), u: a.u + (b.u - a.u) * k };
  }
  function sOnPath(path, x) {
    const T = path.table, sign = Math.sign(T[T.length - 1].p[0] - T[0].p[0]);
    if ((x - T[0].p[0]) * sign <= 0) return (x - T[0].p[0]) * sign;     // not at the route yet: how far short, so the wait comes out right
    for (let i = 1; i < T.length; i++) {
      if ((T[i].p[0] - x) * sign >= 0) return T[i - 1].s + (T[i].s - T[i - 1].s) * (x - T[i - 1].p[0]) / (T[i].p[0] - T[i - 1].p[0]);
    }
    return path.len + (x - T[T.length - 1].p[0]) * sign;
  }
  // Where a follower wants to be right now: level with the leader, then back by a gap that slowly breathes.
  const trailOf = m => m.along * (S.aspect < 1.2 ? m.narrow : 1);
  function placeBehind(p, m = p.follows[0]) {
    const gap = p.reach * (trailOf(m) + p.T_.breathe * Math.sin(TAU * p.lead.s / (p.L * m.every) + m.breath));
    return sOnPath(m.fish.path, onPath(p.lead.path, p.lead.s).p[0]) - gap;
  }
  function spawnParty(party, opts = {}) {
    const pl = opts.pl || planParty(party, opts);
    if (!pl) { for (const f of new Set(party)) log.push({ ev: 'nopath', slug: f.slug, t: S.t }); return null; }
    const T = pl.school ? SCHOOL : BUDDY;
    if (pl.school) pl.follows = pl.follows.slice(0, Math.max(2, T.most - S.active.length - 1));
    const n = pl.follows.length + 1;
    const paces = pl.school ? spread(n, T.tailSplit) : [1 + T.tailSplit, 1 - T.tailSplit];
    const tag = pl.school ? { school: n } : {};
    const lead = spawn(pl.lead.f, { pl: pl.lead, v: pl.v, pace: paces[0], mate: pl.school ? undefined : pl.follows[0].f.slug, ...tag });
    const fish = pl.follows.map((m, i) => spawn(m.f, { pl: m, v: pl.v, pace: paces[i + 1], mate: pl.school ? undefined : pl.lead.f.slug, ...tag }));
    const p = {
      lead, school: pl.school, L: pl.L, reach: pl.reach, T: 0, T_: T,
      follows: pl.follows.map((m, i) => ({ fish: fish[i], along: m.along, narrow: m.narrow, every: T.breatheEvery * (pl.school ? .7 + .6 * R() : 1), breath: R() * TAU })),
    };
    const members = [lead, ...fish];
    for (const a of members) { a.party = p; a.wob = a.tail = 1; }
    if (pl.school) {
      // Tails start spread around the beat, in no order, and each beats a little wider or narrower.
      const beat = R() * TAU, amps = spread(n, T.ampSpread), step = shuffled(members.map((_, i) => i));
      members.forEach((a, i) => { a.phase = beat + TAU * (step[i] + .6 * R()) / n; a.amp = amps[i]; });
    } else { p.follow = fish[0]; lead.pair = fish[0].pair = p; }     // tools/buddy_check.cjs reads a pair by these names
    // Starting behind means waiting a moment at the start of its own route, where it cannot be seen.
    for (const m of p.follows) { const at = placeBehind(p, m); m.fish.s = reduced.matches ? at : Math.min(0, at); }
    S.parties.push(p);
    return lead;
  }
  // Their own clock, in water time: left and right arrows change how fast they go and nothing about how they go.
  function keepCompany(p, dtw) {
    p.T += dtw;
    const T = p.T_, { lead } = p, calm = reduced.matches ? 0 : 1;
    const wander = (a, amp, rate = 1) => 1 + calm * amp * Math.sin(TAU * a.slow * rate * p.T + a.sway);
    lead.wob = wander(lead, T.paceWander);
    for (const m of p.follows) {
      const follow = m.fish;
      let want = wander(follow, T.paceWander);
      if (!lead.gone && !follow.gone) {
        const late = placeBehind(p, m) - follow.s;
        want = lead.wob * lead.v / follow.v + T.keepUp * late / follow.v + wander(follow, T.ownPace) - 1;
      }
      follow.wob += (clamp(want, PACE.min, PACE.max) - follow.wob) * (1 - Math.exp(-dtw / T.settle));
      follow.tail = wander(follow, T.tailWander, 1.7);
    }
    lead.tail = wander(lead, T.tailWander, 1.7);
  }
  // ---- who swims next. A shuffled bag of every fish in the catalog, loaded only as its turn comes.
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // The very first fish decides how long a cold window stays empty, so it is one of the lighter half.
  function lightFirst(list) {
    const b = index.bytes || {}, size = s => (b[s] || 0) + (b[mateOf(s)] || 0);
    const sizes = list.map(size).sort((x, y) => x - y);
    const median = sizes[sizes.length >> 1];
    const i = list.findIndex(s => size(s) <= median);
    return i > 0 ? [list[i], ...list.slice(0, i), ...list.slice(i + 1)] : list;
  }
  // A pair is one turn. In the bag it goes by whichever of the two comes first in the catalog.
  // Its partner has to be swimming this visit: with ?fish=one of them, or ?arrive, it is just a fish.
  function mateOf(slug) {
    const m = PARTNER.get(slug);
    return m && !ARRIVE && catalog.includes(m) ? m : null;
  }
  const turnsOf = list => list.filter(s => { const m = mateOf(s); return !m || list.indexOf(s) < list.indexOf(m); });
  // A school is one turn too. How many swim, or 0 if this fish swims alone this visit.
  function schoolSize(slug) {
    const row = SCHOOLING.includes(slug) && SCHOOLS.find(r => r[0] === slug);
    if (!row || row[1] < 2) return 0;
    return S.aspect < 1.2 ? Math.max(Math.min(3, row[1]), Math.round(row[1] * SCHOOL.narrowCount)) : row[1];
  }
  // One fish that loaded becomes its school here: the same print, once per member, and all of them draw from it.
  const asTurn = party => party.length === 1 && schoolSize(party[0].slug) ? Array(schoolSize(party[0].slug)).fill(party[0]) : party;
  function nextSlug() {
    const out = s => S.active.some(a => a.f.slug === s) || S.ready.some(party => party.some(f => f.slug === s));
    const busy = s => out(s) || (mateOf(s) && out(mateOf(s)));
    // Never two schools at once. The other stays in the bag and takes the next turn it can.
    const schoolOut = S.parties.some(p => p.school) || S.ready.some(isSchool);
    const waits = s => busy(s) || (schoolOut && schoolSize(s));
    if (!S.bag.length) S.bag = shuffled(turnsOf(catalog));
    let i = S.bag.findIndex(s => !waits(s));
    // Only schools left in the bag, with one still out: the next bag comes early, so the window is not left waiting on it.
    if (i < 0 && schoolOut) { S.bag.push(...shuffled(turnsOf(catalog)).filter(s => !S.bag.includes(s))); i = S.bag.findIndex(s => !waits(s)); }
    return i < 0 ? null : S.bag.splice(i, 1)[0];
  }
  function heldNext() {
    const slug = nextSlug();
    const party = fishes.filter(f => f.slug === slug || f.slug === mateOf(slug));
    return party.length ? asTurn(party) : null;
  }
  const loading = new Map();
  function hold(slug) {
    const had = fishes.find(f => f.slug === slug);
    if (had) return Promise.resolve(had);
    if (loading.has(slug)) return loading.get(slug);
    const t0 = performance.now();
    const load = (async () => {
      try {
        const f = prepare(await loadFish(gl, BASE, slug, { maxTex, keep: MANUAL }));
        fishes.push(f);
        log.push({ ev: 'loaded', slug, ms: performance.now() - t0, at: performance.now() });
        return f;
      } catch (e) {
        // One fish that will not load must not stop the water. It sits out the rest of the visit.
        console.warn('fish did not load:', slug, e.message);
        catalog = catalog.filter(s => s !== slug);
        S.bag = S.bag.filter(s => s !== slug);
        return null;
      } finally {
        loading.delete(slug);
      }
    })();
    loading.set(slug, load);
    return load;
  }
  // Whoever is up: a fish, or both of a pair. A pair goes together, so neither is ready until both are in.
  // If one will not load, or is still not in a while after the other, the one that is here swims alone.
  const claimed = new Set();    // loaded and waiting for a partner: not to be evicted
  async function holdTurn(slug) {
    const mate = mateOf(slug);
    if (!mate && schoolSize(slug)) {
      // A school is one print, so it is all here or none of it is. A print that never answers sits out the visit, like one that fails.
      const f = await Promise.race([hold(slug), new Promise(r => setTimeout(r, PARTNER_WAIT * 1000, null))]);
      if (!f) { catalog = catalog.filter(s => s !== slug); S.bag = S.bag.filter(s => s !== slug); return []; }
      return asTurn([f]);
    }
    if (!mate) {
      // A file that never answers must not stop the water. This turn passes, and the fish can still swim later if it comes in.
      const f = await Promise.race([hold(slug), new Promise(r => setTimeout(r, PARTNER_WAIT * 1000, null))]);
      return f ? [f] : [];
    }
    claimed.add(slug); claimed.add(mate);
    const got = [];
    const loads = [slug, mate].map(s => hold(s).then(f => { if (f) got.push(f); return f; }));
    const oneIn = Promise.race(loads.map(l => l.then(f => f || new Promise(() => {}))));
    const waited = oneIn.then(() => new Promise(r => setTimeout(r, PARTNER_WAIT * 1000)));
    await Promise.race([Promise.all(loads), waited]);
    return got.slice();
  }
  // A pair stays on the GPU or leaves it together, so the next time up neither one is waiting on the other.
  function evict() {
    if (MANUAL) return;
    const inUse = f => claimed.has(f.slug) || S.active.some(a => a.f === f) || S.ready.some(party => party.includes(f));
    for (let i = 0; i < fishes.length && fishes.length > HOLD;) {
      const f = fishes[i], mate = fishes.find(x => x.slug === PARTNER.get(f.slug));
      if (inUse(f) || (mate && inUse(mate))) { i++; continue; }
      for (const x of mate ? [f, mate] : [f]) {
        fishes.splice(fishes.indexOf(x), 1);
        disposeFish(gl, x);
        log.push({ ev: 'evicted', slug: x.slug, t: S.t });
      }
    }
  }
  let pumping = null;
  async function fill() {
    while (catalog.length && S.ready.length < READY && !(ARRIVE && S.spawned)) {
      const slug = nextSlug();
      if (!slug) break;       // a short catalog, and all of it is out swimming
      const party = await holdTurn(slug);
      claimed.clear();
      if (party.length) S.ready.push(party);
      evict();
    }
  }
  const planTurn = (party, opts) => party.length > 1 ? planParty(party, opts) : plan(party[0], opts);
  const launch = (party, opts) => party.length > 1 ? spawnParty(party, opts) : spawn(party[0], opts);
  function pump() {
    return pumping = pumping || fill().finally(() => { pumping = null; });
  }

  // ---- the window is never left empty. How many seconds from now is it sure to have a fish showing?
  // Late arrivals and early departures are assumed, since a fish's pace wanders by 22% either way.
  // Also returns when the next fish already on its way arrives, past that stretch.
  function coveredFor(mot) {
    const spans = S.active.filter(a => a.s < a.path.showTo).map(a => {
      const v = a.v * mot;
      return [Math.max(0, a.path.showFrom - a.s) / (v * .78), (a.path.showTo - a.s) / (v * 1.22)];
    }).sort((x, y) => x[0] - y[0]);
    let t = 0;
    for (const [from, to] of spans) {
      if (from > t) return { until: t, coming: from };
      t = Math.max(t, to);
    }
    return { until: t, coming: Infinity };
  }
  // The latest a turn on this plan can be showing, in seconds from now. Of a pair, the leader is the one that arrives first.
  // With reduced motion a fish starts partway along its path, already in view (see spawn).
  function arrivesIn(party, pl, mot) {
    const first = pl.lead || pl;
    return reduced.matches ? 0 : first.path.showFrom / ((pl.v || speedOf(party[0], pl.L) * .88) * mot * .78);
  }
  let nextUp = null;   // the path the next fish will take if the window needs it, planned once
  function keepCovered(mot) {
    if (MANUAL && !S.ready.length) { const h = heldNext(); if (h) S.ready.push(h); }
    const party = S.ready[0];
    if (!party) { pump(); return; }
    if (!nextUp || nextUp.party !== party) nextUp = { party, pl: planTurn(party, { kind: 'cross', show: true }) };
    if (!nextUp.pl) { nextUp = null; return; }     // tries again next step, with new random paths
    const pl = nextUp.pl;
    const arrives = arrivesIn(party, pl, mot);
    const { until, coming } = coveredFor(mot);
    if (until > arrives + COVER_MARGIN / S.speed || arrives >= coming) return;     // the overlap keeps its length in the water, whatever the speed
    if (launch(party, { pl })) { S.ready.shift(); pump(); }
    nextUp = null;
  }
  // Company takes the turn keepCovered is holding, so that turn still has to reach the window before the fish
  // already there have gone. Its own route if it does, by the same reckoning as keepCovered; if not, the crossing
  // planned for it. Without this a fish sent the long way in, out of the haze, can leave the window empty while it comes.
  function companyPlan(party, opts, mot) {
    const own = planTurn(party, opts);
    const { until } = coveredFor(mot);
    if (!until || (own && until > arrivesIn(party, own, mot) + COVER_MARGIN / S.speed)) return own;
    const held = nextUp && nextUp.party === party && nextUp.pl;
    nextUp = null;
    return held || planTurn(party, { kind: 'cross', show: true }) || own;
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
    if (S.speedHeld) S.speedTo = clamp(S.speedTo * Math.exp(S.speedHeld * SPEED.hold * dt), SPEED.min, SPEED.max);
    S.speed += (S.speedTo - S.speed) * clamp(dt * SPEED.ease, 0, 1);

    const maxFish = reduced.matches ? 2 : (S.aspect < 1.2 ? 2 : 3);
    if (!ARRIVE) {
      const showing = () => S.active.filter(a => a.s < a.path.showTo).length;   // one on its way out does not count
      keepCovered(reduced.matches ? .1 : S.speed);     // above the count below, when a far fish would arrive too late
      S.nextSpawn -= dt * S.speed;     // company keeps time with the fish
      if (S.nextSpawn <= 0) {
        // ?manual steps the world in a tight loop with no time to load, but holds every fish already
        // A pair can take the count one over, since it starts while there is room for one.
        let f = showing() >= maxFish || S.parties.some(p => p.school) ? null : S.ready.shift() || (MANUAL ? heldNext() : null);
        // A school waits for the water to thin first. It holds the next turn, so nobody else sets off meanwhile.
        if (f && isSchool(f) && S.active.length > SCHOOL.company) { S.ready.unshift(f); f = null; }
        if (f) {
          const opts = S.spawned === 0 ? { kind: 'cross' } : undefined, pl = companyPlan(f, opts, reduced.matches ? .1 : S.speed);
          launch(f, pl ? { pl } : opts);
        }
        pump();
        // Company for the fish keepCovered guarantees: mostly a little while, sometimes it swims alone.
        S.nextSpawn = !f && showing() < maxFish ? .25 : R() < .28 ? 34 + 26 * R() : 10 + 18 * R();
      }
    } else if (!S.spawned && S.ready.length) {
      // one fish, near enough to see, at an unhurried pace, side to side
      if (spawn(S.ready[0][0], { kind: 'cross', near: [D_MIN + .4, 6], fast: 1.15 })) S.ready.shift();
    }

    for (const p of S.parties) keepCompany(p, (reduced.matches ? .1 : S.speed) * dt);
    for (const a of S.active) {
      const wob = a.party ? a.wob : reduced.matches ? 1 : 1 + .22 * Math.sin(S.t * a.slow * TAU + a.sway);
      const mot = reduced.matches ? .1 : S.speed;
      a.s += a.v * wob * mot * dt;
      a.phase += TAU * a.f.base.tempo * a.pace * wob * (a.party ? a.tail : 1) * mot * dt;   // accumulated: pace changes never jump
    }
    for (let i = S.active.length - 1; i >= 0; i--) {
      const a = S.active[i];
      if (a.s >= a.path.len) {
        S.active.splice(i, 1);
        a.gone = true;
        if (a.party && a.party.lead.gone && a.party.follows.every(m => m.fish.gone)) S.parties.splice(S.parties.indexOf(a.party), 1);
        log.push({ ev: 'gone', id: a.id, slug: a.f.slug, t: S.t });
        if (ARRIVE) S.doneArrive = true;
        evict();
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
      if (o.a.amp) f.swim.amplitude *= o.a.amp;
      if (reduced.matches) { f.swim.amplitude *= .5; f.swim.flap = 0; }
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

  addEventListener('keydown', e => {
    if (e.key === 'i' || e.key === 'I') S.lookTo = S.lookTo ? 0 : 1;
    // Left alone with a modifier held: Cmd-Left is the browser's Back.
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir || reduced.matches || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (e.repeat) return;     // the hold is timed in step, not by the keyboard's repeat rate
    S.speedHeld = dir;
    S.speedTo = clamp(S.speedTo * Math.pow(SPEED.tap, dir), SPEED.min, SPEED.max);
  });
  addEventListener('keyup', e => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir && dir === S.speedHeld) S.speedHeld = 0;
  });
  addEventListener('blur', () => { S.speedHeld = 0; });

  // ---- the water does not wait for any fish, and only ever asks for the next one or two
  const maxTex = Math.min(innerWidth, innerHeight) < 600 ? 1024 : 2048;
  const listed = q.has('fish') || q.has('school');
  let catalog = listed ? [q.get('school'), q.get('fish')].filter(Boolean).join(',').split(',') : index.fish.slice();
  const first = lightFirst(shuffled(turnsOf(catalog)));
  if (ARRIVE) catalog = first.slice(0, 1);
  else if (!listed) S.bag = first;
  // The checks measure every fish, so with ?manual they are all held from the start.
  const loaded = MANUAL ? (async () => { for (const s of catalog) await hold(s); await pump(); })() : pump();

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
  Object.defineProperty(S, 'pairs', { get: () => S.parties.filter(p => !p.school) });   // tools/buddy_check.cjs reads pairs by this name
  window.WATER = {
    S, log, frames, fishes, step, render, loaded, seed, modelOf, spawn, plan, launch, heldNext, PAIRS, BUDDY, SCHOOLS, SCHOOL, schoolSize, PACE, placeBehind, opacity, haze, apparent, yawOf, posAt, dbez, gl, LOOK, exposeReadback, canvas,
  };

  if (MANUAL) { await loaded; window.WATER_READY = true; return; }
  window.WATER_READY = true;
  requestAnimationFrame(t => { last = t; frame(t); });
}
