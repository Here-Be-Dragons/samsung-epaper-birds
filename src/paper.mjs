/**
 * An aged sheet of paper, drawn on the art layer: yellowed and mottled, toned darker toward the edges (where a plate was handled and
 * exposed), flecked with foxing (the small brown spots of old rag paper) and a few faint stains and fibres. Everything comes from a
 * seeded generator, so the same page is drawn every time (the controller redraws only when the picture changes).
 */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const blob = (ctx, x, y, r, rgb, alpha) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
};

/** `base` is the paper's colour ("#rrggbb"); `strength` (0..1) scales the ageing; `scale` is pixels per design unit. */
export function agedPaper(ctx, w, h, { base = '#e3d3ab', strength = 1, seed = 1851, scale = w / 800 } = {}) {
  const rnd = prng(seed);
  const s = strength;
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);

  // Mottling: broad clouds, some darker and yellower, some lighter, where the sheet aged unevenly.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = rnd() * h, r = (90 + rnd() * 260) * scale;
    if (rnd() < 0.62) blob(ctx, x, y, r, '150,112,52', (0.05 + rnd() * 0.07) * s);
    else blob(ctx, x, y, r, '255,246,220', (0.06 + rnd() * 0.08) * s);
  }

  // Toning toward the edges, uneven: strips along each edge and darker corners.
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh, a) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(118,82,38,${a * s})`); g.addColorStop(1, 'rgba(118,82,38,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  const band = 150 * scale;
  edge(0, 0, band, 0, 0, 0, band, h, 0.34 + rnd() * 0.1);
  edge(w, 0, w - band, 0, w - band, 0, band, h, 0.34 + rnd() * 0.1);
  edge(0, 0, 0, band, 0, 0, w, band, 0.32 + rnd() * 0.1);
  edge(0, h, 0, h - band, 0, h - band, w, band, 0.38 + rnd() * 0.1);
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) blob(ctx, x, y, 330 * scale, '110,74,32', 0.3 * s);

  // A few larger faint stains (damp, a rubbed fingertip).
  for (let i = 0; i < 5; i++) blob(ctx, rnd() * w, rnd() * h, (40 + rnd() * 70) * scale, '135,92,42', (0.05 + rnd() * 0.06) * s);

  // Foxing: small brown flecks, more of them toward the edges.
  for (let i = 0, n = Math.round(110 * s); i < n; i++) {
    let x = rnd() * w, y = rnd() * h;
    if (rnd() < 0.5) { const t = rnd() * 0.18; if (rnd() < 0.5) x = rnd() < 0.5 ? t * w : w - t * w; else y = rnd() < 0.5 ? t * h : h - t * h; }
    const r = (1.5 + rnd() * rnd() * 8) * scale;
    blob(ctx, x, y, r, rnd() < 0.5 ? '128,74,28' : '150,96,40', 0.28 + rnd() * 0.32);
  }

  // Fibres: a scatter of short, faint hairs.
  ctx.lineWidth = Math.max(1, scale * 0.7);
  for (let i = 0, n = Math.round(260 * s); i < n; i++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI, l = (6 + rnd() * 20) * scale;
    ctx.strokeStyle = rnd() < 0.6 ? `rgba(120,90,50,${0.07 + rnd() * 0.06})` : `rgba(255,250,235,${0.1 + rnd() * 0.1})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 3, y + Math.sin(a) * l * 0.5 + rnd() * 3, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
}
