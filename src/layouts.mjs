/**
 * The layouts: (ctx, art, model, { w, h }) functions. `model` is { day, window, garden, species, latest, plates (slug -> image),
 * notes (slug -> text), plateNumbers (slug -> n) }.
 *   folio     one bird as a full page from a Victorian folio, the others listed beneath
 *   specimen  up to six birds on one sheet, each with its caption
 *   cluster   the day's birds cut from their plates and grouped on one page (the biggest in the middle), each with its name below
 */
import * as config from './config.mjs';
import { px, isPortrait } from './scale.mjs';
import { packCluster } from './pack.mjs';
import { agedPaper } from './paper.mjs';
import { STYLES } from './plates.mjs';
import { text, paragraph, wrap, doubleRule, ornament, line, paper, placeImage, pendingPlate, PLATE_PAPER, roman, longDate, clock, setFont, measure, fitSize, INK } from './draw.mjs';

const MARGIN = 34;

function header(ctx, model, w, top, { compact = false } = {}) {
  const cx = w / 2;
  text(ctx, `BIRDS OF ${model.garden.toUpperCase()}`, cx, top + px(compact ? 38 : 46), { kind: 'caps', size: compact ? 34 : 42, spacing: 3 });
  text(ctx, `as heard ${model.window === 'today' ? 'on' : 'in ' + model.window + ', to'} ${longDate(model.day)}`, cx, top + px(compact ? 66 : 78), { kind: 'italic', size: compact ? 19 : 22 });
  ornament(ctx, cx, top + px(compact ? 84 : 98), px(compact ? 150 : 190));
  return top + px(compact ? 96 : 112);
}

function footer(ctx, w, h) {
  text(ctx, 'PLATES PAINTED BY FLUX.2  ·  RECORDED BY BIRDNET-GO', w / 2, h - px(MARGIN + 24), { kind: 'caps', size: 13, spacing: 1.5 });
}

function alsoHeard(ctx, model, featured, cx, y, maxW) {
  const others = model.species.filter((s) => s !== featured).map((s) => s.common).sort((a, b) => a.localeCompare(b));
  if (!others.length) return y;
  text(ctx, 'ALSO HEARD', cx, y, { kind: 'caps', size: 15, spacing: 2 });
  y += px(26);
  const shown = others.slice(0, 8);
  const more = others.length - shown.length;
  const str = `${shown.join('  ·  ')}${more > 0 ? `  ·  and ${more} more` : ''}`;
  return paragraph(ctx, str, cx, y, maxW, { kind: 'italic', size: 21, maxLines: 3 });
}

/** A plate: the bird's cut-out set on a cream sheet inside a ruled plate mark (or a hatched card while it is being painted). */
function platePanel(ctx, art, model, species, x, y, w, h) {
  const img = model.cutouts.get(species.slug);
  if (img) {
    art.fillStyle = PLATE_PAPER; art.fillRect(x, y, w, h);
    placeImage(art, img, x + w * 0.07, y + h * 0.07, w * 0.86, h * 0.86, { cover: false });
  } else pendingPlate(ctx, art, x, y, w, h, species);
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, px(2)); ctx.strokeRect(x, y, w, h); // the plate mark
}

export function folioLayout(ctx, art, model, { w, h }) {
  paper(art, w, h);
  const m = px(MARGIN);
  doubleRule(ctx, m, m, w - 2 * m, h - 2 * m);
  const featured = model.featured;
  if (!featured) return emptyPage(ctx, art, model, w, h);
  const portrait = isPortrait();
  const inner = px(MARGIN + 34);
  const note = model.notes.get(featured.slug) || '';
  const facts = [`First heard at ${clock(featured.firstHeard)}`, featured.newToday ? 'a new arrival to the garden' : ''].filter(Boolean).join(', ');
  const plateNo = model.plateNumbers.get(featured.slug) ?? 1;

  if (portrait) {
    let y = header(ctx, model, w, m + px(26));
    const pw = w - 2 * inner, ph = Math.min(pw * 1.2, h * 0.5);
    const py = y + px(34);
    text(ctx, `PLATE ${roman(plateNo)}.`, w - inner, py - px(10), { kind: 'caps', size: 17, spacing: 2, align: 'right' });
    platePanel(ctx, art, model, featured, inner, py, pw, ph);
    y = py + ph + px(64);
    text(ctx, featured.common.toUpperCase(), w / 2, y, { kind: 'caps', size: fitSize(ctx, featured.common.toUpperCase(), 'caps', 48, pw, 3), spacing: 3 });
    y += px(44);
    text(ctx, featured.scientific, w / 2, y, { kind: 'italic', size: 31 });
    y += px(30);
    ornament(ctx, w / 2, y, px(120));
    y += px(40);
    if (note) y = paragraph(ctx, note, w / 2, y, w - 2 * inner - px(40), { size: 25, maxLines: 3 });
    text(ctx, facts, w / 2, y + px(6), { kind: 'italic', size: 21 });
    y += px(48);
    line(ctx, inner, y, w - inner, y, 1);
    alsoHeard(ctx, model, featured, w / 2, y + px(40), w - 2 * inner);
  } else { // landscape: the plate on the left, the page's words on the right
    const colW = (w - 2 * inner - px(30)) / 2;
    const ph = h - 2 * inner - px(20);
    platePanel(ctx, art, model, featured, inner, inner + px(10), Math.min(colW, ph * 0.8), ph);
    const cx = inner + colW + px(30) + colW / 2;
    let y = header(ctx, { ...model, garden: model.garden }, w, m + px(10), { compact: true });
    y += px(40);
    text(ctx, `PLATE ${roman(plateNo)}.`, cx, y, { kind: 'caps', size: 15, spacing: 2 }); y += px(46);
    text(ctx, featured.common.toUpperCase(), cx, y, { kind: 'caps', size: fitSize(ctx, featured.common.toUpperCase(), 'caps', 38, colW, 2), spacing: 2 }); y += px(34);
    text(ctx, featured.scientific, cx, y, { kind: 'italic', size: 26 }); y += px(24);
    ornament(ctx, cx, y, px(100)); y += px(34);
    if (note) y = paragraph(ctx, note, cx, y, colW, { size: 22, maxLines: 4 });
    text(ctx, facts, cx, y + px(4), { kind: 'italic', size: 18 }); y += px(40);
    alsoHeard(ctx, model, featured, cx, y, colW);
  }
  footer(ctx, w, h);
}

export function specimenLayout(ctx, art, model, { w, h }) {
  paper(art, w, h);
  const m = px(MARGIN);
  doubleRule(ctx, m, m, w - 2 * m, h - 2 * m);
  const birds = model.sheet;
  if (!birds.length) return emptyPage(ctx, art, model, w, h);
  const portrait = isPortrait();
  const inner = px(MARGIN + 30);
  const top = header(ctx, model, w, m + px(20), { compact: true }) + px(14);
  const bottom = h - px(MARGIN + 52);
  const cols = portrait ? 2 : 3;
  const rows = Math.ceil(birds.length / cols);
  const gap = px(22);
  const cellW = (w - 2 * inner - gap * (cols - 1)) / cols;
  const cellH = (bottom - top - gap * (rows - 1)) / rows;
  const capH = px(66);
  birds.forEach((sp, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = inner + c * (cellW + gap), y = top + r * (cellH + gap);
    platePanel(ctx, art, model, sp, x, y, cellW, cellH - capH);
    text(ctx, `${roman(model.plateNumbers.get(sp.slug) ?? i + 1)}.`, x + px(10), y + px(24), { kind: 'caps', size: 14, align: 'left', spacing: 1, color: INK });
    text(ctx, sp.common.toUpperCase(), x + cellW / 2, y + cellH - capH + px(28), { kind: 'caps', size: fitSize(ctx, sp.common.toUpperCase(), 'caps', 19, cellW - px(8), 1.5), spacing: 1.5 });
    text(ctx, sp.scientific, x + cellW / 2, y + cellH - capH + px(52), { kind: 'italic', size: 17 });
  });
  footer(ctx, w, h);
}

function emptyPage(ctx, art, model, w, h) {
  header(ctx, model, w, px(MARGIN + 26));
  text(ctx, 'THE GARDEN IS QUIET', w / 2, h / 2, { kind: 'caps', size: 36, spacing: 3 });
  text(ctx, 'No bird has been heard yet.', w / 2, h / 2 + px(44), { kind: 'italic', size: 24 });
  footer(ctx, w, h);
}

const shortDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
};

/** How strong (0..0.22) a white highlight over `paper` may be before its centre comes within ~26 of white (weighted like quantize.mjs). */
export function glowStrength(paper, max = 0.22, clear = 26) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16));
  const norm = Math.sqrt(0.3 * (255 - r) ** 2 + 0.59 * (255 - g) ** 2 + 0.11 * (255 - b) ** 2);
  return norm <= clear ? 0 : Math.max(0, Math.min(max, 1 - clear / norm));
}

/**
 * Where the birds of the cluster go on a w x h page, and how the page is lettered. Shared by the cluster layout (which draws the cut-outs
 * there) and the scene layout (whose picture already holds the birds at these places, so only the names are drawn).
 */
export function clusterPlan(ctx, model, w, h) {
  const look = STYLES[model.style]?.look ?? { paper: '#cfd9d0', label: 'caps' };
  const sans = look.label === 'sans';
  const name = (s) => (sans ? s.toUpperCase() : s);
  const spacing = sans ? 1.4 : 0;
  const labelSize = (isPortrait() ? 19 : 17) * (sans ? 0.8 : 1);
  const footY = h - px(64);
  const birds = model.cluster;
  let rects = [];
  if (birds.length) {
    const items = birds.map((sp) => {
      const img = model.cutouts.get(sp.slug);
      return { key: sp.slug, aspect: img ? img.width / img.height : 1.25, labelW: measure(ctx, name(sp.common), look.label, labelSize, spacing) };
    });
    const margin = px(54);
    const area = { x: margin, y: px(46), w: w - 2 * margin, h: footY - px(74) - px(46) };
    rects = packCluster(items, area, { equal: config.SIZE_BY === 'equal', gap: px(10), labelH: px(labelSize * 1.5), pad: px(10), step: px(8) }).rects;
  }
  return { look, sans, name, spacing, labelSize, footY, rects, paper: config.CLUSTER_PAPER || look.paper };
}

function names(ctx, model, plan) {
  const byKey = new Map(model.cluster.map((sp) => [sp.slug, sp]));
  for (const r of plan.rects) text(ctx, plan.name(byKey.get(r.key).common), r.x + r.w / 2, r.y + r.labelY + px(plan.labelSize), { kind: plan.look.label, size: plan.labelSize, spacing: plan.spacing });
}

function foot(ctx, model, w, h, plan) {
  const { name, sans, look } = plan;
  const when = model.window === 'today' ? 'heard to-day' : `heard in ${model.window}`;
  const count = model.species.length;
  text(ctx, `${name(model.garden)} \u00B7 ${name(when)} \u00B7 ${name(shortDay(model.day))} \u00B7 ${count} ${name('species')}`, w / 2, plan.footY, { kind: look.label, size: sans ? 13 : 16, spacing: sans ? 1.4 : 0.6 });
  const credit = STYLES[model.style]?.credit ?? 'plates';
  const how = model.sceneImage ? 'Composed' : 'Painted';
  text(ctx, `${how} by FLUX.2, ${credit}, from BirdNET-Go\u2019s reference photos`, px(54), h - px(34), { kind: sans ? 'sans' : 'italic', size: sans ? 11 : 13, align: 'left' });
}

export function clusterLayout(ctx, art, model, { w, h }) {
  const plan = clusterPlan(ctx, model, w, h);
  if (plan.look.age) agedPaper(art, w, h, { base: plan.paper, strength: plan.look.age, scale: px(1) });
  else {
    art.fillStyle = plan.paper; art.fillRect(0, 0, w, h);
    // A soft highlight in the middle. A colour that gets within the quantizer's snap distance of white becomes pure white (a hard disc),
    // so the highlight is weakened until its brightest point stays clear of that: none at all on a very light paper.
    const strength = glowStrength(plan.paper);
    if (strength > 0.01) {
      const glow = art.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
      glow.addColorStop(0, `rgba(255,255,255,${strength})`); glow.addColorStop(1, 'rgba(255,255,255,0)');
      art.fillStyle = glow; art.fillRect(0, 0, w, h);
    }
  }
  if (!model.cluster.length) text(ctx, 'The garden is quiet', w / 2, h / 2, { kind: 'italic', size: 30 });
  for (const r of plan.rects) {
    const img = model.cutouts.get(r.key);
    const x = r.x + (r.w - r.dw) / 2;
    if (img) art.drawImage(img, x, r.y, r.dw, r.dh);
    else { // its plate is still being painted: a faint oval stands in
      art.fillStyle = 'rgba(120,140,125,0.28)';
      art.beginPath(); art.ellipse(x + r.dw / 2, r.y + r.dh / 2, r.dw / 2, r.dh / 2.4, 0, 0, Math.PI * 2); art.fill();
    }
  }
  names(ctx, model, plan);
  foot(ctx, model, w, h, plan);
}

/** The scene: one picture (model.sceneImage) that FLUX.2 made from the composed cluster, with the names and footer lettered over it by us. */
export function sceneLayout(ctx, art, model, { w, h }) {
  if (!model.sceneImage) return clusterLayout(ctx, art, model, { w, h });
  const plan = clusterPlan(ctx, model, w, h);
  art.drawImage(model.sceneImage, 0, 0, w, h);
  names(ctx, model, plan);
  foot(ctx, model, w, h, plan);
}

export const LAYOUTS = { cluster: clusterLayout, scene: sceneLayout, folio: folioLayout, specimen: specimenLayout };
export const LAYOUT_NAMES = Object.keys(LAYOUTS);
export const DEFAULT_LAYOUT = 'cluster';
