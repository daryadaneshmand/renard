// The rig: one mesh per fish, the swim in the vertex shader. WebGL2, no libraries.
//
//   offset = A(s) * sin(k*s - phase - lag*d)
//
// s runs head to tail along the body, d runs out along a fin ray. Phase is accumulated by the
// caller (phase += 2*pi*tempo*dt) so changing tempo never makes the fish jump.

export const VS = `#version 300 es
precision highp float;
in vec2 a_pos; in vec2 a_uv; in float a_s; in float a_d; in float a_z; in float a_r;
uniform mat4 u_vp, u_model;
uniform float u_phase, u_k, u_amp, u_env, u_head, u_lag, u_flex, u_thick, u_flap;
uniform vec2 u_hingeN;
out vec2 v_uv;
out vec4 v_clip;
void main() {
  float s = clamp(a_s, 1e-4, 1.0);
  // amplitude along the body, and what a ray adds as it flexes away from its root
  float A  = u_amp * (u_head + (1.0 - u_head) * pow(s, u_env));
  float dA = u_amp * (1.0 - u_head) * u_env * pow(s, u_env - 1.0);
  float F  = u_flex * a_d / (1.0 + 0.6 * a_d);
  float dF = u_flex / ((1.0 + 0.6 * a_d) * (1.0 + 0.6 * a_d));
  float ph = u_k * s - u_phase - u_lag * a_d;
  float sn = sin(ph), cs = cos(ph);
  float off = (A + F) * sn;
  // slope of the bend: toward the tail along the body, along the ray on the tail fan
  float t = smoothstep(0.96, 1.0, s) * smoothstep(0.0, 0.03, a_d);
  float slopeS = dA * sn + A * u_k * cs;
  float slopeD = dF * sn - (A + F) * u_lag * cs;
  float slope = mix(slopeS, slopeD, t);
  // a bent strip is shorter than a straight one: second order, closed form
  vec3 p = vec3(a_pos.x - 0.5 * slope * off, a_pos.y, u_thick * a_z + off);
  // paired fin: lifts about its hinge, never below the body, tip behind root
  if (a_r > 0.0) {
    float al = u_flap * (0.5 + 0.5 * sin(0.5 * u_phase - 2.0 * u_lag * a_r));
    p.xy -= u_hingeN * a_r * (1.0 - cos(al));
    p.z += a_r * sin(al);
  }
  if (u_hingeN != vec2(0.0)) p.z += 0.002;
  v_uv = a_uv;
  v_clip = u_vp * u_model * vec4(p, 1.0);
  gl_Position = v_clip;
}`;

export const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_color, u_ink;
uniform float u_look, u_haze, u_opacity, u_veil;
uniform vec3 u_paper, u_inkc, u_ground, u_linec;
uniform sampler2D u_water;
uniform vec2 u_res;
uniform int u_pass;
out vec4 o;
void main() {
  vec4 c = texture(u_color, v_uv);
  float a = c.a;
  if (u_pass == 0) { if (a < 0.995) discard; a = 1.0; }
  else if (u_pass == 1) { if (a >= 0.995 || a < 0.004) discard; }
  else if (a < 0.004) discard;
  float l = texture(u_ink, v_uv).a;
  vec3 ink = mix(u_paper, u_inkc, l);
  vec3 rgb = mix(c.rgb, ink, u_look);
  rgb = mix(rgb, u_ground, u_haze);
  // far fish sit behind the water's own lines
  if (u_veil > 0.0) rgb = mix(rgb, u_linec, texture(u_water, gl_FragCoord.xy / u_res).r * u_veil);
  a *= u_opacity;
  o = vec4(rgb * a, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export function makeProgram(gl, feedback) {
  const pr = gl.createProgram();
  gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, FS));
  if (feedback) gl.transformFeedbackVaryings(pr, ['v_clip'], gl.INTERLEAVED_ATTRIBS);
  ['a_pos', 'a_uv', 'a_s', 'a_d', 'a_z', 'a_r'].forEach((n, i) => gl.bindAttribLocation(pr, i, n));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  // something valid on the water's unit, for pages with no water
  if (!gl._waterDummy) {
    gl._waterDummy = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gl._waterDummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.activeTexture(gl.TEXTURE0);
  }
  const u = {};
  const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(pr, i).name;
    u[name] = gl.getUniformLocation(pr, name);
  }
  return { pr, u };
}

async function texture(gl, url, aniso, maxTex) {
  const blob = await (await fetch(url)).blob();
  const opt = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  let bmp = await createImageBitmap(blob, opt);
  if (maxTex && Math.max(bmp.width, bmp.height) > maxTex) {
    const k = maxTex / Math.max(bmp.width, bmp.height), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    bmp.close();
    bmp = await createImageBitmap(blob, { ...opt, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
  bmp.close();
  return t;
}

function part(gl, bin, e, floats) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bin, e.vert_off, e.verts * floats), gl.STATIC_DRAW);
  const stride = floats * 4;
  const attr = (i, size, off) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, stride, off * 4);
  };
  attr(0, 2, 0); attr(1, 2, 2); attr(2, 1, 4); attr(3, 1, 5); attr(4, 1, 6); attr(5, 1, 7);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(bin, e.idx_off, e.idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: e.idx, verts: e.verts, hingeN: e.hinge_n || [0, 0], lift: e.lift ?? 1 };
}

export async function loadFish(gl, base, slug, { maxTex } = {}) {
  const dir = `${base}/${slug}`;
  const rig = await (await fetch(`${dir}/rig.json`)).json();
  const bin = await (await fetch(`${dir}/mesh.bin`)).arrayBuffer();
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const fl = rig.mesh.floats;
  const fish = {
    slug, rig,
    body: part(gl, bin, rig.mesh.body, fl),
    color: await texture(gl, `${dir}/color.png`, aniso, maxTex),
    ink: await texture(gl, `${dir}/ink.png`, aniso, maxTex),
    fins: [],
    swim: { ...rig.swim },
    phase: 0,
    bin,
  };
  for (let i = 0; i < rig.mesh.fins.length; i++) {
    fish.fins.push({
      ...part(gl, bin, rig.mesh.fins[i], fl),
      color: await texture(gl, `${dir}/fin${i}-color.png`, aniso, maxTex),
      ink: await texture(gl, `${dir}/fin${i}-ink.png`, aniso, maxTex),
    });
  }
  return fish;
}

export function setSwim(gl, P, fish) {
  const u = P.u, sw = fish.swim;
  gl.uniform1f(u.u_phase, fish.phase);
  gl.uniform1f(u.u_k, 2 * Math.PI / sw.wavelength);
  gl.uniform1f(u.u_amp, sw.amplitude);
  gl.uniform1f(u.u_env, sw.envelope);
  gl.uniform1f(u.u_head, sw.head);
  gl.uniform1f(u.u_lag, sw.lag);
  gl.uniform1f(u.u_flex, sw.flex);
  gl.uniform1f(u.u_thick, sw.thick);
  gl.uniform1f(u.u_flap, sw.flap);
}

// Opaque first so the fish occludes itself in the depth buffer, soft edge on top.
// A fish fading into distance lays its depth down first, then blends once, so it never shows its own back.
export function drawFish(gl, P, fish, model, look, haze, { opacity = 1, veil = 0 } = {}) {
  const u = P.u, sw = fish.swim;
  gl.useProgram(P.pr);
  setSwim(gl, P, fish);
  gl.uniformMatrix4fv(u.u_model, false, model);
  gl.uniform1f(u.u_look, look);
  gl.uniform1f(u.u_haze, haze);
  gl.uniform1f(u.u_opacity, opacity);
  gl.uniform1f(u.u_veil, veil);
  gl.uniform1i(u.u_color, 0);
  gl.uniform1i(u.u_ink, 1);
  gl.uniform1i(u.u_water, 2);
  const one = (m, color, ink) => {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, color);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ink);
    gl.uniform2f(u.u_hingeN, m.hingeN[0], m.hingeN[1]);
    gl.uniform1f(u.u_flap, sw.flap * m.lift);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
  };
  const all = () => {
    one(fish.body, fish.color, fish.ink);
    for (const f of fish.fins) one(f, f.color, f.ink);
  };
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.uniform1i(u.u_pass, 0);
  if (opacity < 0.999) gl.colorMask(false, false, false, false);
  all();
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1i(u.u_pass, opacity < 0.999 ? 2 : 1);
  all();
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// ---- small matrices, column major
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
}
export function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
  }
  return o;
}
// Fish to world. flip = 1 keeps the plate's view, head left; flip = -1 mirrors it, head right.
export function fishModel(x, y, z, scale, yaw, roll, flip) {
  const c = Math.cos(yaw), s = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const sx = scale * flip, sy = scale, sz = scale;
  return new Float32Array([
    c * cr * sx, sr * sx, -s * cr * sx, 0,
    -c * sr * sy, cr * sy, s * sr * sy, 0,
    s * sz, 0, c * sz, 0,
    x, y, z, 1]);
}
