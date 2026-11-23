/**
 * Drawing parts for the plate layouts. Two layers (see quantize.mjs): `ctx` holds everything that is read (text, rules,
 * frames: snapped to the six inks, never dithered) and `art` holds decoration and the plates themselves, in full color.
 */
import path from 'path';
import { GlobalFonts } from '@napi-rs/canvas';
import * as config from './config.mjs';
import { px } from './scale.mjs';
import { BLACK } from './inks.mjs';

/** The Tesserae backyard-birds look: aged cream paper, IM Fell type, double-ruled folio pages. */
export const PAPER = '#efe2c4';
export const PAPER_EDGE = '#dcc79d';
export const PLATE_PAPER = '#f4e9cf';
export const INK = BLACK;

const FONTS = { body: 'IM Fell', italic: 'IM Fell Italic', caps: 'IM Fell SC', sans: 'DejaVu Sans' };
let registered = false;
export function ensureFonts() {
  if (registered) return;
  const reg = (file, family) => GlobalFonts.registerFromPath(path.join(config.FONT_DIR, file), family);
  reg('im_fell-latin.woff2', FONTS.body);
  reg('im_fell-italic-latin.woff2', FONTS.italic);
  reg('im_fell_sc-latin.woff2', FONTS.caps);
  reg('DejaVuSans.ttf', 'DejaVu Sans');
  registered = true;
}
const family = (kind) => `"${FONTS[kind]}", "DejaVu Sans", serif`;
export const setFont = (ctx, kind, size) => { ctx.font = `${px(size)}px ${family(kind)}`; };

function spaced(ctx, spacing, draw) {
  if ('letterSpacing' in ctx) { const old = ctx.letterSpacing; ctx.letterSpacing = `${px(spacing)}px`; draw(); ctx.letterSpacing = old; } else draw();
}

/** Centred (or left/right) text on the content layer; returns the width used. */
export function text(ctx, str, x, y, { kind = 'body', size = 20, align = 'center', spacing = 0, color = INK } = {}) {
  setFont(ctx, kind, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  spaced(ctx, spacing, () => ctx.fillText(str, x, y));
  return ctx.measureText(str).width;
}

export function measure(ctx, str, kind, size, spacing = 0) {
  setFont(ctx, kind, size);
  return ctx.measureText(str).width + (spacing ? px(spacing) * str.length : 0);
}

/** Greedy word wrap to `maxW` pixels; returns the lines (at most `maxLines`, the last ending in an ellipsis if cut). */
export function wrap(ctx, str, maxW, kind, size, maxLines = 99) {
  setFont(ctx, kind, size);
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].replace(/[,;:.\s]+$/, '')}…`;
    return cut;
  }
  return lines;
}

/** A line of wrapped, centred text; returns the y below it. */
export function paragraph(ctx, str, cx, y, maxW, { kind = 'italic', size = 20, lineH = 1.32, maxLines = 4, align = 'center' } = {}) {
  const lines = wrap(ctx, str, maxW, kind, size, maxLines);
  for (const l of lines) { text(ctx, l, cx, y, { kind, size, align }); y += px(size * lineH); }
  return y;
}

export const line = (ctx, x1, y1, x2, y2, w = 1) => { ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, px(w)); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

/** A folio page frame: a heavy rule and a hairline inside it. */
export function doubleRule(ctx, x, y, w, h) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = px(3); ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = Math.max(1, px(1)); ctx.strokeRect(x + px(8), y + px(8), w - px(16), h - px(16));
}

/** A rule with a small diamond in the middle. */
export function ornament(ctx, cx, y, halfW) {
  line(ctx, cx - halfW, y, cx - px(10), y, 1); line(ctx, cx + px(10), y, cx + halfW, y, 1);
  ctx.fillStyle = INK; ctx.beginPath();
  ctx.moveTo(cx, y - px(5)); ctx.lineTo(cx + px(5), y); ctx.lineTo(cx, y + px(5)); ctx.lineTo(cx - px(5), y); ctx.closePath(); ctx.fill();
}

/** The aged paper: a flat cream sheet darkening toward the edges, on the art layer. */
export function paper(art, w, h) {
  art.fillStyle = PAPER; art.fillRect(0, 0, w, h);
  const g = art.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, 'rgba(220,199,157,0)'); g.addColorStop(1, 'rgba(220,199,157,0.55)');
  art.fillStyle = g; art.fillRect(0, 0, w, h);
}

/** Draws `img` into the box, scaled to cover it (cropping the overflow) when `cover`, else fitted whole. */
export function placeImage(art, img, x, y, w, h, { cover = true, crop = 1 } = {}) {
  const iw = img.width * crop, ih = img.height * crop;
  const sx = (img.width - iw) / 2, sy = (img.height - ih) / 2;
  const k = (cover ? Math.max : Math.min)(w / iw, h / ih);
  const dw = iw * k, dh = ih * k;
  art.save(); art.beginPath(); art.rect(x, y, w, h); art.clip();
  art.drawImage(img, sx, sy, iw, ih, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  art.restore();
}

/** The card shown until a bird's plate has been painted. */
export function pendingPlate(ctx, art, x, y, w, h, species, { note = 'Plate in preparation' } = {}) {
  art.fillStyle = PAPER_EDGE; art.fillRect(x, y, w, h);
  art.save(); art.beginPath(); art.rect(x, y, w, h); art.clip();
  art.strokeStyle = '#b39d6f'; art.lineWidth = Math.max(1, px(1.5));
  for (let i = -h; i < w; i += px(14)) { // hatching, as an engraver blocks in a plate not yet cut
    art.beginPath(); art.moveTo(x + i, y + h); art.lineTo(x + i + h, y); art.stroke();
  }
  art.restore();
  const bw = Math.min(w * 0.8, px(340)), bh = px(96);
  art.fillStyle = PAPER; art.fillRect(x + (w - bw) / 2, y + h / 2 - bh / 2, bw, bh);
  ctx.strokeStyle = INK; ctx.lineWidth = px(2); ctx.strokeRect(x + (w - bw) / 2, y + h / 2 - bh / 2, bw, bh);
  text(ctx, note, x + w / 2, y + h / 2 - px(4), { kind: 'caps', size: 20, spacing: 1 });
  text(ctx, species.scientific, x + w / 2, y + h / 2 + px(26), { kind: 'italic', size: 18 });
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export const roman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');

export const longDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
};
export const clock = (hms) => { // "06:16:27" -> "6:16 in the morning"-style, kept plain: 6:16 am
  const [h, m] = String(hms).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
};

/** The largest size (design units, at most `size`) at which `str` fits `maxW` pixels. */
export function fitSize(ctx, str, kind, size, maxW, spacing = 0) {
  let n = size;
  while (n > 10 && measure(ctx, str, kind, n, spacing) > maxW) n -= 1;
  return n;
}
