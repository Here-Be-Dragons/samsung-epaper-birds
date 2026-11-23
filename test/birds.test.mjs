import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.TAXON_LOOKUP = 'false'; // tests never reach GBIF
process.env.BIRDNET_URL = 'http://127.0.0.1:1'; // replaced per test through the server below
const config = await import('../src/config.mjs');
const { openaiClient, comfyWorkflow, comfyClient } = await import('../src/imagegen.mjs');
const { createPlateStore, textPrompt, editPrompt, STYLE_NAMES } = await import('../src/plates.mjs');
const { render, prepare } = await import('../src/render.mjs');
const { geometryFor } = await import('../src/geometry.mjs');
const { speciesSlug, dayKey } = await import('../src/birdnet.mjs');

const serve = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const png = (w = 64, h = 80, color = '#d8b070') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const species = (common, scientific, extra = {}) => ({ common, scientific, slug: speciesSlug(scientific), count: 10, firstHeard: '06:00:00', latestHeard: '12:00:00', thumb: '', ...extra });

test('slugs and day keys', () => {
  assert.equal(speciesSlug('Thryothorus ludovicianus'), 'thryothorus_ludovicianus');
  assert.equal(dayKey(new Date('2026-11-22T03:00:00Z'), 'America/New_York'), '2026-11-21');
});

test('openai backend: generations and edits use the OpenAI images API', async () => {
  const seen = [];
  const img = await png();
  const { server, url } = await serve(async (req, res) => {
    const buf = await body(req);
    seen.push({ url: req.url, type: req.headers['content-type'], len: buf.length, text: buf.toString('latin1') });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }));
  });
  try {
    const c = openaiClient({ baseUrl: url, model: 'flux.2', apiKey: 'k' });
    assert.ok((await c.generate('a robin', { width: 512, height: 640 })).length > 50);
    assert.equal(seen[0].url, '/images/generations');
    const sent = JSON.parse(seen[0].text);
    assert.deepEqual([sent.model, sent.size, sent.prompt], ['flux.2', '512x640', 'a robin']);
    await c.edit(img, 'repaint', { width: 512, height: 640 });
    assert.equal(seen[1].url, '/images/edits');
    assert.match(seen[1].type, /^multipart\/form-data/);
    assert.match(seen[1].text, /name="image"/);
    assert.match(seen[1].text, /repaint/);
  } finally { server.close(); }
});

test('openai backend reports an error answer', async () => {
  const { server, url } = await serve((req, res) => { res.statusCode = 404; res.end('{"detail":"Not Found"}'); });
  try { await assert.rejects(openaiClient({ baseUrl: url }).generate('x'), /404/); } finally { server.close(); }
});

test('comfyui workflow: generate has no reference; edit routes the photo through ReferenceLatent', () => {
  const t2i = comfyWorkflow({ prompt: 'p', width: 768, height: 960, seed: 1 });
  assert.equal(t2i[23], undefined);
  assert.deepEqual(t2i[5].inputs.conditioning, ['4', 0]);
  const edit = comfyWorkflow({ prompt: 'p', width: 768, height: 960, seed: 1, reference: 'ref.png' });
  assert.equal(edit[20].inputs.image, 'ref.png');
  assert.equal(edit[23].class_type, 'ReferenceLatent');
  assert.deepEqual(edit[5].inputs.conditioning, ['23', 0]);
  assert.equal(edit[2].inputs.type, 'flux2');
});

test('comfyui backend: uploads the reference, queues, polls history, downloads the image', async () => {
  const img = await png();
  const calls = [];
  let polls = 0;
  const { server, url } = await serve(async (req, res) => {
    const buf = await body(req);
    calls.push(`${req.method} ${req.url.split('?')[0]}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/upload/image') return res.end('{"name":"ref.png"}');
    if (req.url === '/prompt') { const p = JSON.parse(buf); assert.equal(p.prompt[20].inputs.image, 'ref.png'); return res.end('{"prompt_id":"abc"}'); }
    if (req.url === '/history/abc') return res.end(++polls < 2 ? '{}' : JSON.stringify({ abc: { outputs: { 13: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } } }));
    if (req.url.startsWith('/view')) { res.setHeader('content-type', 'image/png'); return res.end(img); }
    res.statusCode = 404; res.end();
  });
  try {
    const out = await comfyClient({ baseUrl: url, pollMs: 5 }).edit(img, 'repaint', { width: 64, height: 80 });
    assert.deepEqual(out, img);
    assert.deepEqual(calls.filter((c) => !c.includes('history')), ['POST /upload/image', 'POST /prompt', 'GET /view']);
  } finally { server.close(); }
});

test('comfyui backend surfaces an execution error', async () => {
  const { server, url } = await serve(async (req, res) => {
    await body(req); res.setHeader('content-type', 'application/json');
    if (req.url === '/prompt') return res.end('{"prompt_id":"x"}');
    res.end(JSON.stringify({ x: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'out of memory' }]] } } }));
  });
  try { await assert.rejects(comfyClient({ baseUrl: url, pollMs: 5 }).generate('p', { width: 64, height: 64 }), /out of memory/); } finally { server.close(); }
});

test('plate store: paints missing plates once, edits from a reference photo, keeps them on disk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plates-'));
  const calls = [];
  const client = { name: 'fake', generate: async (p) => { calls.push(['generate', p]); return png(); }, edit: async (img, p) => { calls.push(['edit', p]); return png(); } };
  const wren = species('Carolina Wren', 'Thryothorus ludovicianus');
  const owl = species('Barred Owl', 'Strix varia');
  const store = createPlateStore({ client, dir, fetchRef: async (s) => (s === wren ? Buffer.from('photo') : null), log: () => {}, llm: { note: async (s) => `A note on the ${s.common}.` } });
  await store.request([wren, owl], 'gould');
  for (let i = 0; i < 100 && store.status().queued; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['edit', 'generate']);
  assert.match(calls.find((c) => c[0] === 'edit')[1], /Carolina Wren/);
  assert.ok(await store.getPlate(wren, 'gould'));
  assert.equal(await store.getNote(owl), 'A note on the Barred Owl.');
  await store.request([wren, owl], 'gould'); // nothing new to paint
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 2);
  assert.equal((await store.list()).length, 2);
  await store.remove(wren, 'gould');
  assert.equal(await store.getPlate(wren, 'gould'), null);
});

test('plate store: daily cap, failure backoff', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plates-'));
  let n = 0, fail = true;
  const client = { name: 'fake', generate: async () => { n++; if (fail) throw new Error('GPU busy'); return png(); }, edit: async () => png() };
  const logs = [];
  const a = species('A', 'Aus a'), b = species('B', 'Bus b');
  const store = createPlateStore({ client, dir, fetchRef: async () => null, log: (m) => logs.push(m), perDay: 1 });
  await store.request([a], 'gould');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
  assert.match(store.status().failures[0].reason, /GPU busy/);
  await store.request([a], 'gould'); // within the retry window: not tried again
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
  fail = false;
  await store.request([b], 'gould');
  await store.request([species('C', 'Cus c')], 'gould');
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(await store.getPlate(b, 'gould'));
  assert.ok(logs.some((l) => /daily limit/.test(l)), 'the second new plate waits for tomorrow');
});

test('prompts name the bird and the style', () => {
  const s = species('Blue Jay', 'Cyanocitta cristata');
  for (const style of STYLE_NAMES) {
    assert.match(textPrompt(s, style), /Blue Jay \(Cyanocitta cristata\)/);
    assert.match(editPrompt(s, style), /No text/);
  }
});

test('prompts follow the kind of animal and the key colour', async () => {
  const { KEY_COLOURS, pickKey } = await import('../src/keys.mjs');
  const frog = species('Green Frog', 'Lithobates clamitans', { taxon: 'frog' });
  const dog = species('Red Fox', 'Vulpes vulpes', { taxon: 'mammal' });
  const jay = species('Blue Jay', 'Cyanocitta cristata', { taxon: 'bird' });
  assert.match(textPrompt(frog, 'gould'), /frog.*lily pad/s);
  assert.doesNotMatch(textPrompt(frog, 'gould'), /bird|feather/);
  assert.match(editPrompt(dog, 'gould', KEY_COLOURS[1]), /pure cyan \(#00FFFF\)/);
  assert.match(editPrompt(dog, 'gould'), /Keep what it rests on in the photograph/);
  assert.match(textPrompt(jay, 'gould'), /perched on a small sprig/);
  assert.match(textPrompt(jay, 'gould'), /no magenta anywhere on the bird/);
  // a photo with a lot of pink and purple in the middle is not painted on magenta
  const pink = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 70, b: 170 } } }).png().toBuffer();
  assert.notEqual((await pickKey(pink)).name, 'magenta');
  const grey = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer();
  assert.equal((await pickKey(grey)).name, 'magenta');
  assert.equal((await pickKey(null)).name, 'magenta');
});

test('wildlife filter and GBIF groups', async () => {
  const { isExcluded } = await import('../src/birdnet.mjs');
  const { groupFromGbif } = await import('../src/taxa.mjs');
  assert.ok(isExcluded({ common: 'Human vocal', scientific: 'Human vocal' }));
  assert.ok(isExcluded({ common: 'Dog_Dog', scientific: 'Dog_Dog' }));
  assert.ok(!isExcluded({ common: 'Gunnison Sage-Grouse', scientific: 'Centrocercus minimus' }), 'whole names only');
  assert.equal(groupFromGbif({ kingdom: 'Animalia', class: 'Aves' }), 'bird');
  assert.equal(groupFromGbif({ kingdom: 'Animalia', class: 'Amphibia', order: 'Anura' }), 'frog');
  assert.equal(groupFromGbif({ kingdom: 'Animalia', class: 'Insecta' }), 'insect');
  assert.equal(groupFromGbif({ kingdom: 'Animalia', class: 'Chilopoda' }), 'other');
  assert.equal(groupFromGbif({ kingdom: 'Plantae', class: 'Magnoliopsida' }), null);
  assert.equal(groupFromGbif({ matchType: 'NONE' }), null);
});

test('taxonomy asks GBIF once per species and keeps the answer', async () => {
  const { createTaxonomy } = await import('../src/taxa.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tax-'));
  let calls = 0;
  const fetchImpl = async (u) => { calls++; return { ok: true, json: async () => (/Hyla/.test(u) ? { kingdom: 'Animalia', class: 'Amphibia', order: 'Anura' } : { matchType: 'NONE' }) }; };
  const tax = createTaxonomy({ dir, enabled: true, fetchImpl });
  const list = [species('Gray Treefrog', 'Hyla versicolor'), species('Static', 'Noise noise')];
  const out = await tax.annotate(list);
  assert.deepEqual(out.map((s) => [s.common, s.taxon]), [['Gray Treefrog', 'frog']]);
  await createTaxonomy({ dir, enabled: true, fetchImpl }).annotate([species('Gray Treefrog', 'Hyla versicolor')]);
  assert.equal(calls, 2, 'the second run read the kept answers');
  const off = await createTaxonomy({ dir: await fs.mkdtemp(path.join(os.tmpdir(), 'tax-')), enabled: false, fetchImpl }).annotate([species('X', 'Y z')]);
  assert.equal(off.length, 1, 'with lookup off nothing is dropped');
});

const demoModel = async (withPlate) => {
  const sp = [species('Carolina Wren', 'Thryothorus ludovicianus', { count: 50 }), species('Blue Jay', 'Cyanocitta cristata', { count: 20, firstHeard: '07:00:00' })];
  const cut = await sharp({ create: { width: 256, height: 200, channels: 4, background: { r: 170, g: 60, b: 40, alpha: 1 } } }).png().toBuffer();
  const cutouts = new Map(withPlate ? [[sp[0].slug, cut]] : []);
  return { day: '2026-11-22', window: 'today', garden: 'The Garden', style: 'gould', species: sp, latest: sp[0], cutouts, notes: new Map([[sp[0].slug, 'A restless bird of the hedge.']]) };
};

for (const layout of ['folio', 'specimen']) {
  test(`${layout} renders a portrait PNG, with or without plates, and is deterministic`, async () => {
    const geometry = geometryFor({ width: 720, height: 1280, rotation: 0 });
    const a = await render(await demoModel(true), { geometry, layout });
    const b = await render(await demoModel(true), { geometry, layout });
    const c = await render(await demoModel(false), { geometry, layout });
    const meta = await sharp(a).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [720, 1280, 'png']);
    assert.deepEqual(a, b, 'the same birds give the same picture (no clock on the page)');
    assert.notDeepEqual(a, c, 'a landed plate changes the picture');
  });
}

test('a rotated display draws landscape and still delivers its image size; exact-ink mode leaves only the six inks', async () => {
  const model = await demoModel(true);
  const out = await render(model, { geometry: geometryFor({ width: 720, height: 1280, rotation: 90 }), layout: 'folio', art: 'pattern', text: 'threshold' });
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [720, 1280]);
  const { data } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const inks = new Set(['0,0,0', '255,255,255', '255,0,0', '255,255,0', '0,255,0', '0,0,255']);
  for (let i = 0; i < data.length; i += 3 * 97) assert.ok(inks.has(`${data[i]},${data[i + 1]},${data[i + 2]}`), `pixel ${i / 3} is not an ink`);
});

test('an empty day renders the quiet page', async () => {
  const out = await render({ day: '2026-11-22', window: 'today', garden: 'The Garden', species: [], latest: null, cutouts: new Map() }, { geometry: geometryFor({ width: 720, height: 1280, rotation: 0 }), layout: 'folio' });
  assert.ok(out.length > 1000);
});

test('plate numbers follow the order the birds were first heard; the sheet shows six', () => {
  const sp = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => species(x, `Genus ${x}`, { count: 100 - i, firstHeard: `0${9 - i}:00:00` }));
  const { model } = prepare({ species: sp, latest: sp[0], cutouts: new Map() }, 'specimen');
  assert.equal(model.sheet.length, 6);
  assert.equal(model.plateNumbers.get(speciesSlug('Genus g')), 1);
  assert.equal(model.plateNumbers.get(speciesSlug('Genus a')), 7);
});
