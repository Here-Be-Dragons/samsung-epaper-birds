/**
 * Scene mode (prototype): the cluster's cut-out birds are composed on the style's paper at about 1.3 megapixels, and one FLUX.2 edit
 * pass paints a single continuous background and light around them, so the birds read as one scene. The birds are meant to stay as they
 * are; the names and footer are lettered over the result by the scene layout (so no text comes from the model).
 */
import { createCanvas } from '@napi-rs/canvas';
import { planBirds } from './render.mjs';
import { STYLES } from './plates.mjs';

/** The composed picture (PNG) at `width` pixels wide (the page's shape), with the birds where the cluster layout puts them. */
export async function composeScene(model, { geometry, width = 864 }) {
  const { plan, cutouts } = await planBirds(model, { geometry });
  const k = width / geometry.width;
  const w = Math.round(width / 16) * 16, h = Math.round((geometry.height * k) / 16) * 16;
  const canvas = createCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.fillStyle = plan.paper; ctx.fillRect(0, 0, w, h);
  for (const r of plan.rects) {
    const img = cutouts.get(r.key);
    if (img) ctx.drawImage(img, (r.x + (r.w - r.dw) / 2) * k, r.y * k, r.dw * k, r.dh * k);
  }
  return { png: canvas.toBuffer('image/png'), width: w, height: h, plan };
}

export function scenePrompt(style) {
  const s = STYLES[style];
  return 'Keep every bird exactly as drawn: the same species, pose, size, position, colours and markings. Do not move, resize, add, remove, redraw or restyle any bird. '
    + `Fill only the empty background around the birds with one continuous, softly painted ground in the same ${s?.credit ?? 'illustrated'} style as the birds: a gentle wash of the paper colour, `
    + 'a few faint leafy branches and sprigs that run behind and between the birds so that they appear to share one scene, with consistent soft light and a faint shadow under each bird. '
    + 'Keep the background quiet and low in contrast so the birds stay the focus, and leave clear empty space under every bird. No text, no letters, no labels, no border, no frame.';
}

/** One FLUX.2 edit pass over the composed picture. Returns image bytes. */
export function paintScene(client, composite, style, { width, height, seed } = {}) {
  return client.edit(composite, scenePrompt(style), { width, height, seed });
}
