/**
 * Packs the cut-out birds into one cluster, the way a specimen sheet is laid out: the biggest bird in the middle, the rest placed one
 * after another at the nearest free spot on a widening oval walk, and then the whole group grown as large as the page allows.
 *
 * Each item is a bird (drawn `dw` x `dh`) with a name under it; the two together are one rectangle for collisions. Item i is the i-th
 * biggest. `fit` does the growing: it finds the largest scale at which the packed group still fits the page's free area.
 */
const GOLDEN = 2.399963;

/** The size (pixels) of the bird and its label rectangle for an item at long side `long`. */
function sizeOf(item, long, { gap, labelH }) {
  const dw = item.aspect >= 1 ? long : long * item.aspect;
  const dh = item.aspect >= 1 ? long / item.aspect : long;
  return { dw, dh, w: Math.max(dw, item.labelW), h: dh + gap + labelH };
}

/** Places rectangles around (0,0); returns them with their centres. `ey` stretches the walk to the page's shape. */
function place(sizes, { pad, ey, step }) {
  const placed = [];
  const free = (cx, cy, s) => placed.every((p) => Math.abs(cx - p.cx) >= (s.w + p.w) / 2 + pad || Math.abs(cy - p.cy) >= (s.h + p.h) / 2 + pad);
  sizes.forEach((s, i) => {
    if (i === 0) { placed.push({ ...s, cx: 0, cy: 0 }); return; }
    for (let r = step; r < 1e5; r += step) {
      const count = Math.max(12, Math.ceil((2 * Math.PI * r) / (step * 2)));
      let best = null;
      for (let j = 0; j < count; j++) {
        const a = i * GOLDEN + (j * 2 * Math.PI) / count;
        const cx = r * Math.cos(a), cy = r * Math.sin(a) * ey;
        if (free(cx, cy, s)) { const d = Math.hypot(cx, cy / ey); if (!best || d < best.d) best = { cx, cy, d }; }
      }
      if (best) { placed.push({ ...s, cx: best.cx, cy: best.cy }); return; }
    }
  });
  // Pull everything toward the middle until it touches a neighbour, a few rounds, so the group is tight.
  const clear = (i, cx, cy) => placed.every((p, j) => j === i || Math.abs(cx - p.cx) >= (placed[i].w + p.w) / 2 + pad || Math.abs(cy - p.cy) >= (placed[i].h + p.h) / 2 + pad);
  const nudge = Math.max(2, step / 2);
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (let i = 1; i < placed.length; i++) {
      const p = placed[i];
      for (let guard = 0; guard < 600; guard++) {
        const len = Math.hypot(p.cx, p.cy / ey) || 1;
        const ux = -p.cx / len, uy = (-p.cy / ey) / len * ey;
        const tries = [[p.cx + ux * nudge, p.cy + uy * nudge], [p.cx + Math.sign(-p.cx) * nudge, p.cy], [p.cx, p.cy + Math.sign(-p.cy) * nudge]];
        const ok = tries.find(([x, y]) => (Math.abs(x) < Math.abs(p.cx) || Math.abs(y) < Math.abs(p.cy)) && clear(i, x, y));
        if (!ok) break;
        p.cx = ok[0]; p.cy = ok[1]; moved = true;
      }
    }
    if (!moved) break;
  }
  return placed;
}

const extents = (placed) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed) { x0 = Math.min(x0, p.cx - p.w / 2); x1 = Math.max(x1, p.cx + p.w / 2); y0 = Math.min(y0, p.cy - p.h / 2); y1 = Math.max(y1, p.cy + p.h / 2); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

/**
 * items: [{ key, aspect (width / height of the cut-out), labelW }], the biggest first.
 * area: { x, y, w, h } the free part of the page. Returns [{ key, x, y, dw, dh, w, h, labelY }] (x, y: top-left of the bird+name
 * rectangle; the bird is centred in it; labelY: where the name's top is, relative to y) and the scale used.
 */
export function packCluster(items, area, { equal = false, minRatio = 0.4, maxLong = area.w * 0.62, gap = 10, labelH = 34, pad = 10, step = 8 } = {}) {
  const n = items.length;
  if (!n) return { rects: [], long: 0 };
  const ratio = (i) => (equal || n === 1 ? (equal ? 0.7 : 1) : 1 - (1 - minRatio) * (i / (n - 1)));
  const ey = area.h / area.w;
  const attempt = (k) => place(items.map((it, i) => sizeOf(it, k * ratio(i), { gap, labelH })), { pad, ey, step: Math.max(4, Math.min(step, k * 0.03)) });
  let lo = 24, hi = maxLong;
  const fits = (k) => { const e = extents(attempt(k)); return e.w <= area.w && e.h <= area.h; };
  if (fits(hi)) lo = hi;
  else { for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } }
  const placed = attempt(lo);
  const e = extents(placed);
  const ox = area.x + (area.w - e.w) / 2 - e.x0, oy = area.y + (area.h - e.h) / 2 - e.y0;
  const rects = placed.map((p, i) => ({ key: items[i].key, x: p.cx - p.w / 2 + ox, y: p.cy - p.h / 2 + oy, dw: p.dw, dh: p.dh, w: p.w, h: p.h, labelY: p.dh + gap }));
  return { rects, long: lo };
}
