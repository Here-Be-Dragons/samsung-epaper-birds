/**
 * Cuts a bird from its paper. A plate is painted on a plain pale ground, so the ground is found by spreading in from the picture's
 * edges through pixels that stay close to the paper colour and change gently from one pixel to the next (a vignette is gentle, the edge
 * of a feather is not). A white bird outlined on white therefore stays whole: the spreading stops at its outline. Small specks and
 * enclosed scraps of paper are removed, the edge is eroded a pixel (to lose the paper-coloured fringe) and feathered, and the result is
 * trimmed to the bird. The output is a PNG with alpha.
 */
import sharp from 'sharp';

const median = (arr) => { const a = Uint8Array.from(arr).sort(); return a[a.length >> 1]; };

export async function cutOut(imageBytes, { reach = 70, step = 14, hole = 34, holeArea = 0.03, speck = 0.015, feather = 1.1, erode = 1, despill = false } = {}) {
  const { data, info } = await sharp(imageBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const N = W * H;
  const at = (i, c) => data[i * 3 + c];

  // The paper: the median colour of a ring along the edge.
  const ring = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const rs = [[], [], []];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < ring || y < ring || x >= W - ring || y >= H - ring) { const i = y * W + x; for (let c = 0; c < 3; c++) rs[c].push(at(i, c)); }
  }
  const paper = rs.map(median);
  const far = (i) => Math.max(Math.abs(at(i, 0) - paper[0]), Math.abs(at(i, 1) - paper[1]), Math.abs(at(i, 2) - paper[2]));
  const jump = (i, j) => Math.max(Math.abs(at(i, 0) - at(j, 0)), Math.abs(at(i, 1) - at(j, 1)), Math.abs(at(i, 2) - at(j, 2)));

  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  const spread = (seeds, near, maxPixels = N) => { // flood fill; returns the pixels it claimed
    let head = 0, tail = 0;
    const claimed = [];
    for (const s of seeds) { if (!bg[s] && !seen[s]) { seen[s] = 1; queue[tail++] = s; } }
    while (head < tail) {
      const i = queue[head++];
      claimed.push(i);
      if (claimed.length > maxPixels) return null;
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || bg[j] || seen[j]) continue;
        if (far(j) <= near && jump(i, j) <= step) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    return claimed;
  };
  let seen = new Uint8Array(N);
  const border = [];
  for (let x = 0; x < W; x++) { border.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { border.push(y * W, y * W + W - 1); }
  for (const i of spread(border.filter((i) => far(i) <= reach), reach)) bg[i] = 1;

  // Enclosed scraps of paper (between the legs and the perch): paper-coloured regions that are small.
  seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (bg[i] || seen[i] || far(i) > hole) continue;
    const got = spread([i], hole, Math.round(N * holeArea));
    if (got) for (const j of got) bg[j] = 1;
  }

  // Keep the bird and what is joined to it: drop specks.
  const label = new Int32Array(N);
  const sizes = [0];
  for (let i = 0; i < N; i++) {
    if (bg[i] || label[i]) continue;
    const id = sizes.length;
    let head = 0, tail = 0, n = 0;
    queue[tail++] = i; label[i] = id;
    while (head < tail) {
      const p = queue[head++]; n++;
      const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !bg[q] && !label[q]) { label[q] = id; queue[tail++] = q; }
      }
    }
    sizes.push(n);
  }
  const biggest = Math.max(0, ...sizes);
  if (!biggest) throw new Error('nothing but paper in this picture');
  const keep = (i) => !bg[i] && sizes[label[i]] >= biggest * speck;

  // Erode (the fringe of the old ground goes with it), then find the bird's box.
  let alive = new Uint8Array(N);
  for (let i = 0; i < N; i++) alive[i] = keep(i) ? 1 : 0;
  const edgeOf = (a, x, y, i) => x === 0 || y === 0 || x === W - 1 || y === H - 1 || !a[i - 1] || !a[i + 1] || !a[i - W] || !a[i + W];
  for (let pass = 0; pass < erode; pass++) {
    const next = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (alive[i] && !edgeOf(alive, x, y, i)) next[i] = 1; }
    alive = next;
  }
  // Despill: within a few pixels of the cut, take the ground's colour cast out of the bird's edge (the ground tints what it touches).
  if (despill) {
    let near = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (alive[i] && edgeOf(alive, x, y, i)) near[i] = 1; }
    for (let d = 0; d < 6; d++) {
      const grown = near.slice();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (alive[i] && !near[i] && (near[i - 1] || near[i + 1] || near[i - W] || near[i + W])) grown[i] = 1;
      }
      near = grown;
    }
    // The cast is whatever the ground has over grey: for a magenta ground, red and blue above green.
    const cast = [paper[0] - paper[1], paper[2] - paper[1]];
    for (let i = 0; i < N; i++) {
      if (!near[i]) continue;
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      if (cast[0] > 40 && cast[1] > 40) { // magenta-ish ground
        const spill = Math.min(r - g, b - g);
        if (spill > 0) { data[i * 3] = r - spill; data[i * 3 + 2] = b - spill; }
      }
    }
  }
  const mask = new Uint8Array(N);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!alive[i]) continue;
    mask[i] = 255;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('the bird is too small to cut out');
  const pad = Math.round(Math.max(W, H) * 0.01) + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };

  const alpha = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(feather).extract(box).extractChannel(0).raw().toBuffer();
  const rgb = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).extract(box).raw().toBuffer();
  const rgba = Buffer.alloc(box.width * box.height * 4);
  for (let i = 0, n = box.width * box.height; i < n; i++) {
    rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width: box.width, height: box.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/** Settings for a bird painted on a flat magenta ground (plates.GROUND): only near-magenta pixels are ground. */
export const KEYED = { reach: 60, step: 30, hole: 60, holeArea: 0.04, erode: 3, despill: true };
