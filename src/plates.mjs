/**
 * The plates: one 1800s-style illustration per species and style, made once by FLUX.2 and kept on disk.
 *
 * A plate is made in the background (a FLUX.2 pass takes tens of seconds), one at a time. Until it exists a frame
 * shows a "plate in preparation" card, and when it lands the picture changes, so the next check redraws the panel.
 * With a reference photo from BirdNET-Go the painter EDITS the photo (so the field marks are right); without
 * one it paints from the name alone. A short field note per species is written by the local chat model.
 */
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import * as config from './config.mjs';
import { fetchThumbnail } from './birdnet.mjs';
import { cutOut, KEYED } from './cutout.mjs';
import { KEY_COLOURS, pickKey } from './keys.mjs';
import { TAXA, taxonOf } from './taxa.mjs';

export const STYLES = {
  gould: {
    label: 'Hand-coloured lithograph (Gould)',
    medium: 'a Victorian hand-coloured lithograph from a natural history folio in the manner of John Gould and Edward Lear, 1840s: the bird drawn in fine, dark engraved line work with visible cross-hatching and stippling for the feather detail and shadows, then coloured by hand with thin, transparent watercolour washes in clean period pigments, applied slightly unevenly and not quite filling the outlines, with a little pigment pooling. Keep the line work dark and the bird\'s colours and markings faithful to the real species',
    greyscale: false,
    credit: 'hand-coloured lithographs after Gould',
    look: { paper: '#ffffff', label: 'caps' },
    tone: { saturation: 0.86, fade: 0.1, warm: [1, 0.975, 0.9] },
  },
  audubon: {
    label: 'Watercolour plate (Audubon)',
    medium: 'a hand-painted watercolour plate engraved for a nineteenth-century ornithology book in the manner of John James Audubon: delicate feather detail, muted natural colours, a touch of foxing',
    greyscale: false,
    credit: 'watercolours after Audubon',
    look: { paper: '#ffffff', label: 'caps' },
    tone: { saturation: 0.9, fade: 0.06, warm: [1, 0.985, 0.93] },
  },
  engraving: {
    label: 'Black-ink engraving',
    medium: 'a black-ink copperplate engraving from an eighteenth-century natural history book: fine cross-hatching and stippling, no colour at all, only black ink',
    greyscale: true,
    credit: 'copperplate engravings',
    look: { paper: '#ffffff', label: 'caps' },
  },
  woodblock: {
    label: 'Japanese woodblock print',
    medium: 'a Japanese ukiyo-e woodblock print of the kacho-e (bird and flower) tradition: flat areas of muted colour, a fine black keyline, delicate gradated bokashi shading and the grain of the wood showing in the ink',
    greyscale: false,
    credit: 'woodblock prints in the ukiyo-e manner',
    look: { paper: '#ffffff', label: 'caps' },
  },
  midcentury: {
    label: 'Mid-century modern (Harper)',
    medium: 'a mid-century modern graphic illustration in the manner of Charley Harper: the bird reduced to clean geometric shapes (circles, triangles, wedges), flat colour in a handful of bold tones, no outlines and no shading, true to the species\' markings',
    greyscale: false,
    credit: 'mid-century modern illustrations after Harper',
    look: { paper: '#ffffff', label: 'sans' },
  },
};
export const STYLE_NAMES = Object.keys(STYLES);

// The animal is painted on a flat key colour it does not wear (chosen per animal, keys.mjs), so that it can be cut out cleanly (a pale
// breast on cream paper cannot). The colour is also forbidden on the animal and its perch, which FLUX.2 mostly respects.
export function groundFor(key = KEY_COLOURS[0], noun = 'bird') {
  return `flat solid pure ${key.name} (${key.hex}) background, one uniform colour edge to edge, with no gradient, no shadow, no paper texture and no vignette, with nothing at all behind the ${noun} (no circle, disc, sun, frame, border or shape), and with no ${key.name} anywhere on the ${noun} or on its perch`;
}
export const GROUND = groundFor();

/** A style's medium, worded for the kind of animal (the styles are written for birds). */
export function mediumFor(style, taxon = 'bird') {
  const m = STYLES[style].medium;
  if (taxon === 'bird') return m;
  const noun = TAXA[taxon]?.noun ?? 'animal';
  return m.replace(/the bird's/g, `the ${noun}'s`).replace(/the bird/g, `the ${noun}`)
    .replace(/for the feather detail/g, 'for the detail').replace(/delicate feather detail/g, 'delicate detail')
    .replace(/ornithology book/g, 'natural history book');
}

/** Ages a cut-out's colours (RGBA PNG in, PNG out): paler and browner blacks, less saturation, a warm cast. Alpha is untouched. */
export async function toneCutout(png, t) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ink = [46, 33, 22];
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    const dark = (1 - lum / 255) * t.fade; // the darker a pixel, the more the faded ink shows
    for (let c = 0; c < 3; c++) {
      let v = lum + (data[i + c] - lum) * t.saturation;
      v = v + (ink[c] - v) * dark;
      data[i + c] = Math.max(0, Math.min(255, v * t.warm[c] + dark * 18));
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

export function textPrompt(species, style, key = KEY_COLOURS[0]) {
  const t = TAXA[taxonOf(species)];
  return `${mediumFor(style, taxonOf(species))}, of ${t.article} ${species.common} (${species.scientific}). A single ${t.noun} ${t.pose}, on ${t.perch}, `
    + `the perch a short complete piece that ends naturally well inside the picture, centred on a ${groundFor(key, t.noun)}, with generous empty margins. No text, no caption, no border, no signature, no other animals.`;
}
export function editPrompt(species, style, key = KEY_COLOURS[0]) {
  const t = TAXA[taxonOf(species)];
  return `Redraw the ${t.noun} in this photograph as ${mediumFor(style, taxonOf(species))}. It is ${t.article} ${species.common} (${species.scientific}): keep its species, pose and exact markings. `
    + `Keep what it rests on in the photograph (the branch, twig, leaves, rock, log, reed or grass) and draw it in the same style as part of the picture: a short, complete piece, `
    + `its ends tapering or finishing naturally with a few leaves, entirely inside the frame and never running to the edge. If the photograph shows nothing it rests on, give it ${t.perch}. `
    + `Replace everything else in the background with a ${groundFor(key, t.noun)}. The whole ${t.noun} stays visible and centred with generous empty margins. No text, no caption, no border, no signature.`;
}

export function createPlateStore({ client = null, dir = config.PLATE_DIR, fetchRef = fetchThumbnail, llm = null, mode = config.PLATE_MODE, perDay = config.PLATES_PER_DAY, now = () => Date.now(), log = console.log } = {}) {
  const memory = new Map();
  const queued = new Set();
  const failures = new Map(); // key -> { at, reason }
  const queue = [];
  let working = false, madeToday = { day: '', n: 0 };
  const FAIL_RETRY_MS = 6 * 3600 * 1000;

  const file = (style, slug, ext = 'png') => path.join(dir, style, `${slug}.${ext}`);
  const cutFile = (style, slug) => file(style, slug, 'cut.png');
  const cutting = new Map();
  const noteFile = (slug) => path.join(dir, 'notes', `${slug}.txt`);

  async function readCached(style, slug) {
    const key = `${style}/${slug}`;
    if (memory.has(key)) return memory.get(key);
    try { const buf = await fs.readFile(file(style, slug)); memory.set(key, buf); return buf; } catch { return null; }
  }
  /** The kept plate (PNG bytes) or null. */
  const getPlate = (species, style) => readCached(style, species.slug);

  /** The bird cut from its paper (PNG with alpha), made from the plate on first use and kept; null if there is no plate. */
  async function getCutout(species, style) {
    const key = `${style}/${species.slug}`;
    if (cutting.has(key)) return cutting.get(key);
    const job = (async () => {
      try { return await fs.readFile(cutFile(style, species.slug)); } catch { /* make it */ }
      const plate = await readCached(style, species.slug);
      if (!plate) return null;
      try {
        let cut = await cutOut(plate, KEYED);
        if (STYLES[style].greyscale) cut = await sharp(cut).greyscale().png().toBuffer(); // an engraving is black ink only
        if (STYLES[style].tone) cut = await toneCutout(cut, STYLES[style].tone);
        await fs.writeFile(cutFile(style, species.slug), cut);
        return cut;
      } catch (err) { log(` [cutout] ${species.common}: ${err.message}`); return null; }
    })();
    cutting.set(key, job);
    const out = await job;
    if (!out) cutting.delete(key); // try again later (a plate may land)
    return out;
  }

  async function getNote(species) {
    try { return (await fs.readFile(noteFile(species.slug), 'utf8')).trim(); } catch { return ''; }
  }

  async function makeNote(species) {
    if (!llm || (await getNote(species))) return;
    try {
      const text = await llm.note(species);
      if (text) { await fs.mkdir(path.dirname(noteFile(species.slug)), { recursive: true }); await fs.writeFile(noteFile(species.slug), text); }
    } catch (err) { log(` [notes] ${species.common}: ${err.message}`); }
  }

  async function paint(species, style) {
    const opts = { width: config.PLATE_WIDTH, height: config.PLATE_HEIGHT };
    let raw, how = 'text';
    const ref = mode === 'text' ? null : await fetchRef(species);
    const key = await pickKey(ref); // the ground colour this animal does not wear
    if (ref && mode !== 'text') { raw = await client.edit(ref, editPrompt(species, style, key), opts); how = 'edit'; }
    else if (mode === 'edit') throw new Error('no reference photo for this species and PLATE_MODE=edit');
    else raw = await client.generate(textPrompt(species, style, key), opts);
    const png = await sharp(raw).png({ compressionLevel: 9 }).toBuffer();
    await fs.mkdir(path.dirname(file(style, species.slug)), { recursive: true });
    await fs.writeFile(file(style, species.slug), png);
    await fs.writeFile(file(style, species.slug, 'json'), JSON.stringify({ species: species.scientific, common: species.common, style, how, taxon: taxonOf(species), key: key.hex, backend: client.name, at: new Date(now()).toISOString() }, null, 1));
    memory.set(`${style}/${species.slug}`, png);
    cutting.delete(`${style}/${species.slug}`);
    await fs.rm(cutFile(style, species.slug), { force: true });
    await getCutout(species, style); // so a plate is never shown before its cut-out exists
    return how;
  }

  async function work() {
    if (working) return;
    working = true;
    try {
      while (queue.length) {
        const { species, style, force, noteOnly } = queue.shift();
        const key = `${style}/${species.slug}`;
        try {
          await makeNote(species);
          if (!client || noteOnly) continue;
          const day = new Date(now()).toISOString().slice(0, 10);
          if (madeToday.day !== day) madeToday = { day, n: 0 };
          if (!force && madeToday.n >= perDay) { log(` [plates] daily limit of ${perDay} reached; ${species.common} waits for tomorrow`); continue; }
          const t0 = now();
          const how = await paint(species, style);
          madeToday.n++;
          failures.delete(key);
          log(` \u{1F3A8} [plates] ${species.common}: painted by ${client.name} (${how}, ${style}) in ${Math.round((now() - t0) / 1000)}s`);
        } catch (err) {
          failures.set(key, { at: now(), reason: err.message });
          log(` ⚠️  [plates] ${species.common}: ${err.message}`);
        } finally { queued.delete(key); }
      }
    } finally { working = false; }
  }

  /** Queues the species that have no plate yet (busiest first); returns at once. */
  async function request(speciesList, style, { force = false } = {}) {
    for (const species of speciesList) {
      const key = `${style}/${species.slug}`;
      if (queued.has(key)) continue;
      if (!force && (await readCached(style, species.slug)) && (await getNote(species) || !llm)) continue;
      const failed = failures.get(key);
      if (!force && failed && now() - failed.at < FAIL_RETRY_MS) continue;
      if (!force && (await readCached(style, species.slug))) { queued.add(key); queue.push({ species, style, force, noteOnly: true }); continue; }
      queued.add(key);
      queue.push({ species, style, force });
    }
    if (queue.length) work();
  }

  async function remove(species, style) {
    memory.delete(`${style}/${species.slug}`);
    await fs.rm(file(style, species.slug), { force: true });
    await fs.rm(file(style, species.slug, 'json'), { force: true });
    await fs.rm(cutFile(style, species.slug), { force: true });
    cutting.delete(`${style}/${species.slug}`);
  }

  /** What is on disk, for the gallery page. */
  async function list() {
    const out = [];
    for (const style of STYLE_NAMES) {
      let names = [];
      try { names = await fs.readdir(path.join(dir, style)); } catch { /* none yet */ }
      for (const n of names.filter((f) => f.endsWith('.json') && !f.endsWith('.cut.json'))) {
        try { out.push(JSON.parse(await fs.readFile(path.join(dir, style, n), 'utf8'))); } catch { /* skip */ }
      }
    }
    return out;
  }

  return { getPlate, getCutout, getNote, request, remove, list, paint, status: () => ({ queued: queue.length, working, madeToday: madeToday.n, failures: [...failures].map(([k, v]) => ({ key: k, ...v })) }) };
}

/** A local OpenAI-compatible chat model that writes each species' field note in the voice of a Victorian naturalist. */
export function createNoteWriter({ baseUrl = config.LLM_URL, apiKey = config.LLM_API_KEY, model = config.LLM_MODEL } = {}) {
  let resolved = model;
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  return {
    async note(species) {
      if (!resolved) {
        const res = await fetch(`${baseUrl}/models`, { headers: auth, signal: AbortSignal.timeout(10000) });
        resolved = (await res.json())?.data?.[0]?.id;
        if (!resolved) throw new Error('the chat server lists no model');
      }
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          model: resolved, temperature: 0.7, max_tokens: 160,
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: 'system', content: 'You are a Victorian naturalist writing the caption for a plate in a natural history folio. Be accurate and restrained.' },
            { role: 'user', content: `Write a field note of one or two sentences, at most 30 words, about the ${species.common} (${species.scientific}): its habits, haunts or song. Plain prose in an 1800s voice. No title, no quotation marks, no markdown, no mention of dates or numbers.` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`chat answered ${res.status}`);
      const text = (await res.json())?.choices?.[0]?.message?.content ?? '';
      return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_#>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
    },
  };
}
