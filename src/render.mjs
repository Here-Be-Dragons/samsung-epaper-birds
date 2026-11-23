/**
 * Renders one frame: draws the layout on two layers (content and art), turns them into the panel's six exact inks
 * (quantize.mjs) and encodes PNG. Frames render one at a time because px() reads the current geometry.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import * as config from './config.mjs';
import { useGeometry } from './geometry.mjs';
import { serial } from './queue.mjs';
import { ensureFonts } from './draw.mjs';
import { createQuantizer } from './quantize.mjs';
import { LAYOUTS, DEFAULT_LAYOUT, clusterPlan } from './layouts.mjs';

const renderQueue = serial();
const quantizers = new Map();
const quantizerFor = (art, text, alphaCut) => {
  const key = `${art}|${text}|${alphaCut}`;
  if (!quantizers.has(key)) quantizers.set(key, createQuantizer({ perceived: config.PANEL_PALETTE, art, text, alphaCut }));
  return quantizers.get(key);
};

/**
 * `model`: { day, window, garden, style, species, latest, cutouts (slug -> PNG bytes with alpha), notes (slug -> text) }.
 * The page numbers and the birds each layout shows are decided here, so they depend only on what was heard.
 */
export function render(model, { geometry, layout: asked = DEFAULT_LAYOUT, art: artMode = config.ART_DITHER, text: textMode = config.TEXT_AA, textCut = config.TEXT_CUT } = {}) {
  if (!LAYOUTS[asked]) throw new Error(`Unknown layout "${asked}"`);
  if (!config.TEXT_MODES.includes(textMode)) throw new Error(`Unknown text mode "${textMode}"`);
  if (!config.ART_MODES.includes(artMode)) throw new Error(`Unknown art mode "${artMode}"`);
  return renderQueue(async () => {
    ensureFonts();
    useGeometry(geometry);
    const w = geometry.width, h = geometry.height;
    const contentCanvas = createCanvas(w, h), artCanvas = createCanvas(w, h);
    const ctx = contentCanvas.getContext('2d'), art = artCanvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    const shown = prepare(model, asked);
    // Decode only the plates this layout will show.
    const cutouts = new Map();
    for (const sp of shown.needed) {
      const cut = model.cutouts?.get(sp.slug);
      if (cut) cutouts.set(sp.slug, await loadImage(cut));
    }
    const sceneImage = model.scene && asked === 'scene' ? await loadImage(model.scene) : null;
    LAYOUTS[asked](ctx, art, { ...shown.model, cutouts, sceneImage }, { w, h });
    const quantizer = quantizerFor(artMode, textMode, textCut);
    const rgb = quantizer.compose(art.getImageData(0, 0, w, h).data, ctx.getImageData(0, 0, w, h).data, w, h);
    return encodeFrame(rgb, w, h, geometry.rotation, { exactInks: quantizer.exactInks });
  });
}

/** Which birds a layout shows, and the plate numbers (by the order the birds were first heard today). */
export function prepare(model, layout) {
  const species = model.species ?? [];
  const byFirst = [...species].sort((a, b) => (a.firstHeard || '').localeCompare(b.firstHeard || '') || a.scientific.localeCompare(b.scientific));
  const plateNumbers = new Map(byFirst.map((s, i) => [s.slug, i + 1]));
  const featured = (config.FEATURE === 'top' ? species[0] : model.latest) ?? species[0] ?? null;
  // The sheet: the busiest six, shown in the order they were first heard (so the set is stable between redraws).
  const sheet = species.slice(0, 6).sort((a, b) => plateNumbers.get(a.slug) - plateNumbers.get(b.slug));
  // The cluster: the busiest birds, the most heard first (so the most heard is the biggest and sits in the middle).
  const cluster = species.slice(0, config.MAX_BIRDS);
  const needed = layout === 'cluster' || layout === 'scene' ? cluster : layout === 'specimen' ? sheet : featured ? [featured] : [];
  return { needed, model: { ...model, featured, sheet, cluster, plateNumbers, notes: model.notes ?? new Map(), garden: model.garden ?? config.GARDEN_NAME } };
}

export async function encodeFrame(rgb, width, height, rotation = config.OUTPUT_ROTATION, { exactInks = true } = {}) {
  const r = ((rotation % 360) + 360) % 360;
  let pipeline = sharp(rgb, { raw: { width, height, channels: 3 } });
  if (r !== 0) pipeline = pipeline.rotate(r);
  if (config.IMAGE_FORMAT === 'jpeg') return pipeline.jpeg({ quality: config.JPEG_QUALITY, chromaSubsampling: '4:4:4' }).toBuffer();
  if (!exactInks) return pipeline.png({ effort: 7, compressionLevel: 9 }).toBuffer();
  return pipeline.png({ palette: true, colours: 8, dither: 0, effort: 7, compressionLevel: 9 }).toBuffer();
}

/** Where the cluster's birds go at this geometry (and the decoded cut-outs): what the scene is composed from. */
export function planBirds(model, { geometry, layout = 'cluster' }) {
  return renderQueue(async () => {
    ensureFonts();
    useGeometry(geometry);
    const shown = prepare(model, layout);
    const cutouts = new Map();
    for (const sp of shown.needed) { const cut = model.cutouts?.get(sp.slug); if (cut) cutouts.set(sp.slug, await loadImage(cut)); }
    const ctx = createCanvas(1, 1).getContext('2d');
    const m = { ...shown.model, cutouts };
    return { plan: clusterPlan(ctx, m, geometry.width, geometry.height), cutouts, birds: m.cluster, style: m.style };
  });
}
