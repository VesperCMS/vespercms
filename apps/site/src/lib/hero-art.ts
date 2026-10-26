/*
 * The home page's hero: Vesper's mark ("Launch", DECISIONS.md) drawn by a
 * WebGL fragment shader across the whole hero, behind its words. The V
 * draws itself, the evening star ignites at the end of its rise, and then
 * the star breathes, a beacon ring leaves it now and then, and a haze
 * drifts around it, leaning toward the pointer.
 *
 * The mark is a signed distance field in the SVG's own 64-unit box, so it's
 * the same drawing as Mark.astro at any size. The colours are the site's
 * tokens, read from CSS, so the art follows the theme toggle. The canvas is
 * opaque and paints the page's own surface wherever the art fades out, and
 * everything that glows stays faint away from the mark, so the hero's text
 * keeps its contrast over it.
 *
 * Without WebGL the static SVG in the slot stays. With reduced motion there
 * is one still frame, the mark complete; it's drawn again only on resize or
 * a theme change. Offscreen or in a background tab, nothing runs.
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uCenter;   // the mark's centre, in canvas pixels (y up)
uniform float uSize;    // the mark's 64-unit box, in canvas pixels
uniform float uHeight;  // the canvas height, in pixels
uniform float uTime;
uniform float uReveal;  // 0..1, how much of the V is drawn
uniform float uStar;    // the star's scale, overshooting as it ignites
uniform float uFlash;   // the ignition's burst of light
uniform vec2 uPointer;  // -1..1 across the canvas, smoothed
uniform float uDark;
uniform vec3 uSurface;
uniform vec3 uInk;
uniform vec3 uAccent;

const vec2 A = vec2(12.0, 14.0);
const vec2 B = vec2(30.0, 50.0);
const vec2 C = vec2(43.0, 25.0);
const vec2 S = vec2(51.0, 12.0);
const float L1 = 40.2492; // |AB|
const float L2 = 28.1780; // |BC|

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// Distance to segment ab, and how far along it the closest point lies (0..1).
vec2 segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  float unit = uSize / 64.0;
  // Mark space: the SVG's box, y down, centred on uCenter.
  vec2 m = vec2(px.x - uCenter.x, uCenter.y - px.y) / unit + 32.0;
  float aa = 1.0 / unit;

  // How near the mark this pixel is, in mark sizes: the art lives here.
  vec2 q = (px - uCenter) / uSize;
  float near = smoothstep(1.7, 0.0, length(q * vec2(0.8, 1.0)));
  // The canvas's top and bottom fade into the page.
  float edges = smoothstep(0.0, 0.12, px.y / uHeight) * smoothstep(0.0, 0.08, 1.0 - px.y / uHeight);

  // Haze: two layers of noise drifting apart, leaning toward the pointer.
  vec2 drift = q * 2.2 + uPointer * vec2(-0.12, 0.08);
  float haze = fbm(drift + vec2(uTime * 0.035, -uTime * 0.02));
  haze = haze * 0.6 + 0.4 * fbm(drift * 1.7 - vec2(uTime * 0.02, uTime * 0.03));
  float glow = smoothstep(0.35, 0.85, haze) * near * mix(0.07, 0.16, uDark);

  // The star's light: a soft bloom, breathing, and four long thin rays.
  vec2 v = m - S;
  float dist = length(v);
  float breathe = 0.85 + 0.15 * sin(uTime * 1.3);
  float bloom = exp(-dist / 9.0) * (0.55 * breathe + 1.6 * uFlash) * uStar;
  float angle = 0.32 + uPointer.x * 0.12;
  vec2 w = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * v;
  float rays = exp(-abs(w.y) * 1.3) * exp(-abs(w.x) * 0.085)
             + exp(-abs(w.x) * 1.3) * exp(-abs(w.y) * 0.085);
  rays *= (0.22 + 0.06 * sin(uTime * 2.1 + 1.0) + 0.8 * uFlash) * uStar;
  // A beacon ring every few seconds, widening and fading.
  float cycle = fract(uTime / 5.5);
  float ring = exp(-abs(dist - cycle * 70.0) / 1.6) * (1.0 - cycle) * (1.0 - cycle) * 0.22 * uStar;
  glow += (bloom + rays + ring) * mix(0.55, 1.0, uDark);

  // Stars in the dark theme's sky, twinkling, only around the mark.
  if (uDark > 0.5) {
    float size = unit * 6.0;
    vec2 cell = floor(px / size);
    float pick = hash(cell);
    if (pick > 0.9) {
      vec2 at = (cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * size;
      float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + 2.0 * hash(cell + 1.3)) + pick * 40.0);
      float speck = smoothstep(1.6, 0.0, length(px - at) / max(unit * 0.35, 1.0));
      glow += speck * twinkle * near * 0.5;
    }
  }

  glow *= edges;
  vec3 col = uSurface;
  // Dark: light adds. Light: the accent tints the sand, never brighter than it.
  col = mix(mix(col, uAccent, clamp(glow * 0.55, 0.0, 0.6)), col + uAccent * glow, uDark);

  // The V, drawn up to uReveal along its length, with round ends.
  float total = L1 + L2;
  float s = uReveal * total;
  float d = 1e5;
  float along = 0.0;
  if (s > 0.0) {
    vec2 e1 = A + (B - A) * clamp(s / L1, 0.0, 1.0);
    vec2 first = segment(m, A, e1);
    d = first.x;
    along = first.y * min(s, L1);
    if (s > L1) {
      vec2 e2 = B + (C - B) * clamp((s - L1) / L2, 0.0, 1.0);
      vec2 second = segment(m, B, e2);
      if (second.x < d) {
        d = second.x;
        along = L1 + second.y * (s - L1);
      }
    }
  }
  d -= 4.5;
  // Lit by the star near the top of the rise, and now and then a glint that
  // sweeps across it diagonally. (Along the stroke, it would jump where the
  // two strokes overlap at the bottom.)
  float lit = smoothstep(42.0, 6.0, dist) * 0.45 * uStar;
  float band = m.x + m.y * 0.6 - (mod(uTime * 22.0, 160.0) - 40.0);
  float sheen = exp(-band * band / 50.0) * 0.4 * uStar;
  vec3 ink = mix(uInk, uAccent, clamp(lit + sheen, 0.0, 1.0));
  // The drawing tip glows while the V is being drawn.
  float tip = smoothstep(0.0, 0.08, uReveal) * (1.0 - smoothstep(0.92, 1.0, uReveal));
  ink = mix(ink, uAccent, tip * smoothstep(8.0, 0.0, abs(along - s)));
  // A faint glow around the stroke in the dark.
  col += uAccent * exp(-max(d, 0.0) / 3.0) * 0.18 * uDark * step(0.001, uReveal);
  col = mix(col, ink, clamp(0.5 - d / aa, 0.0, 1.0));

  // The star: its 20% halo, as in the SVG, then the disc.
  float r = 5.5 * uStar;
  col = mix(col, uAccent, 0.2 * clamp(0.5 - (dist - 10.0 * uStar) / aa, 0.0, 1.0) * step(0.001, uStar));
  vec3 core = mix(uAccent, vec3(1.0), uDark * 0.35 * smoothstep(r, 0.0, dist));
  col = mix(col, core, clamp(0.5 - (dist - r) / aa, 0.0, 1.0) * step(0.001, uStar));

  // Dither, so the gradients don't band.
  col += (hash(px + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

type Rgb = [number, number, number];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** The V's draw, then the star's ignition, as a function of seconds since start. */
function intro(t: number) {
  const reveal = easeInOut(clamp01((t - 0.3) / 1.5));
  const ignite = clamp01((t - 1.65) / 0.8);
  // Out of nothing, past full size, and back (an ease-out-back).
  const star = 1 + 2.70158 * (ignite - 1) ** 3 + 1.70158 * (ignite - 1) ** 2;
  const flash = Math.sin(Math.PI * Math.min(1, ignite * 1.6)) * (1 - ignite * 0.6);
  return { reveal, star, flash };
}

export function startHeroArt(hero: HTMLElement): void {
  const canvas = hero.querySelector<HTMLCanvasElement>('[data-hero-canvas]');
  const slot = hero.querySelector<HTMLElement>('[data-hero-slot]');
  const probe = hero.querySelector<HTMLElement>('[data-hero-probe]');
  if (!canvas || !slot || !probe) return;

  const fail = () => {
    hero.dataset.art = 'static';
  };
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return fail();

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment) return fail();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail();
  gl.useProgram(program);

  // One triangle that covers the canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    center: uniform('uCenter'),
    size: uniform('uSize'),
    height: uniform('uHeight'),
    time: uniform('uTime'),
    reveal: uniform('uReveal'),
    star: uniform('uStar'),
    flash: uniform('uFlash'),
    pointer: uniform('uPointer'),
    dark: uniform('uDark'),
    surface: uniform('uSurface'),
    ink: uniform('uInk'),
    accent: uniform('uAccent'),
  };

  // The tokens are oklch inside light-dark(); the probe resolves them for
  // the current theme, and a 2D canvas turns that into sRGB bytes.
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const read = (token: string): Rgb => {
    probe.style.color = `var(${token})`;
    if (!swatch) return [0, 0, 0];
    swatch.fillStyle = '#000';
    swatch.fillStyle = getComputedStyle(probe).color;
    swatch.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = swatch.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };
  const readColours = () => {
    const surface = read('--surface');
    gl.uniform3fv(u.surface, surface);
    gl.uniform3fv(u.ink, read('--content'));
    gl.uniform3fv(u.accent, read('--accent'));
    const luminance = 0.2126 * surface[0] + 0.7152 * surface[1] + 0.0722 * surface[2];
    gl.uniform1f(u.dark, luminance < 0.5 ? 1 : 0);
  };

  const place = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    // Keep the pixel count sane on big, dense screens.
    const scale = Math.min(ratio, Math.sqrt(3_200_000 / Math.max(1, box.width * box.height)));
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const art = slot.getBoundingClientRect();
    const x = (art.left + art.width / 2 - box.left) * scale;
    const y = (art.top + art.height / 2 - box.top) * scale;
    gl.uniform2f(u.center, x, canvas.height - y);
    gl.uniform1f(u.size, Math.min(art.width, art.height) * scale);
    gl.uniform1f(u.height, canvas.height);
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0;
  let last = 0;
  let frame = 0;
  let visible = true;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const draw = () => {
    // With reduced motion, the finished mark at a calm moment.
    const t = reduced.matches ? 4 : elapsed;
    const { reveal, star, flash } = reduced.matches ? { reveal: 1, star: 1, flash: 0 } : intro(t);
    gl.uniform1f(u.time, t);
    gl.uniform1f(u.reveal, reveal);
    gl.uniform1f(u.star, star);
    gl.uniform1f(u.flash, flash);
    gl.uniform2f(u.pointer, pointer.x, pointer.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now: number) => {
    frame = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    elapsed += dt;
    const ease = 1 - Math.exp(-dt * 2.5);
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    draw();
    schedule();
  };
  const schedule = () => {
    if (frame || reduced.matches || !visible || document.hidden) {
      last = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };

  readColours();
  place();
  draw();
  hero.dataset.art = 'live';

  new ResizeObserver(() => {
    place();
    draw();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible) schedule();
    else stop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else schedule();
  });
  reduced.addEventListener('change', () => {
    draw();
    schedule();
  });
  // A theme change redraws at once, inside the toggle's view transition.
  const recolour = () => {
    readColours();
    draw();
  };
  new MutationObserver(recolour).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolour);
  window.addEventListener(
    'pointermove',
    (event) => {
      const box = canvas.getBoundingClientRect();
      pointer.tx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
      pointer.ty = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
    },
    { passive: true },
  );
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stop();
    fail();
  });
  schedule();
}
