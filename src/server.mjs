/**
 * Serves the 1800s bird-plate frame to one or more Samsung EMDX e-paper panels, with the same content-delivery
 * convention and panel conversation as samsung-epaper-calendar (see docs/PROTOCOL.md):
 *
 *   GET /api/display-content/:id/content.json  -> manifest (escaped JSON)
 *   GET /api/display-content/:id/image          -> the frame (PNG)
 *
 * Every refresh interval, for each display, the birds BirdNET-Go heard are looked up, the plates FLUX.2 has painted
 * for them are laid out on a page, and the frame is compared with the one on the panel (controller.mjs). Plates that
 * do not exist yet are painted in the background (plates.mjs); when one lands the picture changes and is sent.
 */
import express from 'express';
import { createHash, randomUUID } from 'crypto';
import getLocalIp from '@loxjs/node-local-ip';

import * as config from './config.mjs';
import { getBirds } from './birdnet.mjs';
import { createImageClient } from './imagegen.mjs';
import { createPlateStore, createNoteWriter, STYLE_NAMES } from './plates.mjs';
import { render, prepare } from './render.mjs';
import { LAYOUT_NAMES } from './layouts.mjs';
import { createController } from './controller.mjs';
import { startMqtt } from './mqtt.mjs';
import { geometryFor } from './geometry.mjs';
import { pushFrame, checkBattery, sleepPanel } from './panel.mjs';
import { isConfigured as mdcConfigured } from './mdcPush.mjs';
import { publicUrlWarnings } from './netcheck.mjs';

const app = express();
let localIp = getLocalIp();
if (typeof localIp !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(localIp)) {
  console.warn('[config] Could not auto-detect LAN IP (common inside Docker): set PUBLIC_HOST to this machine’s LAN IP. Falling back to "localhost".');
  localIp = 'localhost';
}

const displays = config.DISPLAYS;
const displayById = new Map(displays.map((d) => [d.id, d]));
const geometryOf = (d, overrides = {}) => geometryFor({ width: d.width, height: d.height, rotation: d.rotation, ...overrides });

const THEME_SETTINGS = STYLE_NAMES; // a display's "theme" is its art style
for (const d of displays) {
  if (!THEME_SETTINGS.includes(d.theme)) throw new Error(`Display "${d.id}": unknown style "${d.theme}". Available: ${THEME_SETTINGS.join(', ')}`);
  if (!LAYOUT_NAMES.includes(d.layout)) throw new Error(`Display "${d.id}": unknown layout "${d.layout}". Available: ${LAYOUT_NAMES.join(', ')}`);
}

// pushId -> { contentJson, imageBuffer, createdAt, hash, displayId, fetched, onFetch }. Each display keeps
// only its latest frame.
const pendingImages = new Map();
const currentPush = new Map(); // display id -> the pushId of the frame it serves now
const lastFetchedHash = new Map(); // display id -> hash of the last picture the panel itself downloaded

// With no PUBLIC_HOST the address is looked up each time, so a laptop that changes network tells the panel where it is now.
function currentLocalIp() {
  const ip = getLocalIp();
  return typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : localIp;
}
function baseUrl() {
  if (config.PUBLIC_URL) return config.PUBLIC_URL;
  return `http://${config.PUBLIC_HOST || currentLocalIp()}:${config.PORT}`;
}

/**
 * The manifest the panel fetches (schema reverse-engineered by Joyous and the frontpage project; the
 * escaped slashes and string file_size are applied when it is served). `token` is the content ID, used
 * as file_id, file_name and id: the panel silently ignores a push whose file name it has seen.
 */
function buildManifest({ pushId, token, imageBuffer }) {
  const ext = config.IMAGE_FORMAT === 'png' ? 'png' : 'jpg';
  const fileName = `${token}.${ext}`;
  return {
    schedule: [{
      start_date: '1970-01-01',
      stop_date: '2999-12-31',
      start_time: '00:00:00',
      contents: [{
        image_url: `${baseUrl()}/api/display-content/${pushId}/image`,
        file_id: token,
        file_path: `/home/owner/content/Downloads/vxtplayer/epaper/mobile/contents/${token}/${fileName}`,
        duration: 91326, // the constant both reference projects use
        file_size: `${imageBuffer.length}`,
        file_name: fileName,
      }],
    }],
    name: 'samsung-epaper-birds',
    version: 1,
    create_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    id: token,
    program_id: 'com.samsung.ios.ePaper',
    content_type: 'ImageContent',
    deploy_type: 'MOBILE',
    ship: 'birds',
    data_source: 'birdnet-go',
  };
}

const imageClient = createImageClient();
const plateStore = createPlateStore({ client: imageClient, llm: config.NOTES ? createNoteWriter() : null });

// The birds are looked up once for all displays, and reused briefly.
let birdCache = { at: 0, promise: null };
function currentBirds() {
  if (!birdCache.promise || Date.now() - birdCache.at > 60000) {
    birdCache = { at: Date.now(), promise: getBirds() };
    birdCache.promise.catch(() => { birdCache = { at: 0, promise: null }; });
  }
  return birdCache.promise;
}

/** The birds, with the plates and notes that exist for them in `style`; the missing ones are queued to be painted. */
async function modelFor(style, layout, { now } = {}) {
  const birds = now ? await getBirds({ now }) : await currentBirds();
  const { needed } = prepare({ ...birds }, layout);
  const cutouts = new Map(), notes = new Map();
  for (const sp of birds.species) {
    if (needed.includes(sp)) { const cut = await plateStore.getCutout(sp, style); if (cut) cutouts.set(sp.slug, cut); }
    const note = await plateStore.getNote(sp);
    if (note) notes.set(sp.slug, note);
  }
  // Paint what the page shows first, then the rest of the day's birds, so the next layout is ready too.
  if (imageClient || config.NOTES) plateStore.request([...new Set([...needed, ...birds.species.slice(0, 24)])], style).catch((err) => console.warn(` [plates] ${err.message}`));
  return { ...birds, cutouts, notes, style, garden: config.GARDEN_NAME };
}

/** Draws the frame a display would show now, and the counts Home Assistant reports. */
async function renderFor(display, { layout, theme }) {
  let model;
  try { model = await modelFor(theme, layout); } catch (err) {
    console.warn(` [birdnet] ${err.message}`);
    throw err; // a frame without the birds would wipe the panel: keep what it shows and try again next time
  }
  const image = await render(model, { geometry: geometryOf(display), layout });
  return { image, summary: { eventsToday: model.species.length, shoppingOpen: null, feedsOk: true, themeActive: theme } };
}

/**
 * Makes `imageBuffer` the display's served frame and hands it to the panel (waking it if needed),
 * then waits until the panel has really downloaded it. The content ID is a hash of the picture, so the
 * same picture is never a "new" one to the panel; `fresh` adds a nonce for when it must be redrawn anyway.
 */
async function deliver(display, imageBuffer, { fresh = false, progress = () => {} } = {}) {
  const hash = createHash('sha256').update(imageBuffer).digest('hex');
  const configured = mdcConfigured(display);
  if (configured && !fresh && lastFetchedHash.get(display.id) === hash) {
    return { configured, pushed: true, confirmed: true, reason: 'the panel already holds this picture' };
  }
  const token = `${display.id}-${hash.slice(0, 16)}${fresh ? `-${Date.now().toString(36)}` : ''}`.toUpperCase();
  const pushId = randomUUID().toUpperCase();
  const entry = { contentJson: buildManifest({ pushId, token, imageBuffer }), imageBuffer, createdAt: Date.now(), hash, displayId: display.id, fetched: false, onFetch: null };
  pendingImages.set(pushId, entry);
  const previous = currentPush.get(display.id);
  currentPush.set(display.id, pushId);
  if (previous) pendingImages.delete(previous);

  const contentUrl = `${baseUrl()}/api/display-content/${pushId}/content.json`;
  console.log(`\n\u{1F5BC} [${display.id}] Frame ${token} rendered (${(imageBuffer.length / 1024).toFixed(0)} KB)`);
  if (!configured) {
    console.log(` \u2139\uFE0F  [${display.id}] Serve-only mode (no host/PIN, or pushes disabled): frame updated, nothing pushed`);
    return { configured, pushed: false, reason: 'serve-only' };
  }
  const waitForFetch = (ms) => new Promise((resolve) => {
    if (entry.fetched) return resolve(true);
    const timer = setTimeout(() => { entry.onFetch = null; resolve(false); }, ms);
    entry.onFetch = () => { clearTimeout(timer); resolve(true); };
  });
  console.log(` \u{1F504} [${display.id}] Pushing to panel ${display.host}${display.wake ? ' (will wake it if asleep)' : ''}`);
  try {
    const out = await pushFrame({ display, contentUrl, waitForFetch }, { progress });
    const wake = out.wakeSeconds ? `, woke in ${out.wakeSeconds}s` : '';
    const battery = out.battery ? `, battery ${out.battery.percent}%${out.battery.source ? ` (${out.battery.source})` : ''}` : '';
    if (out.confirmed) console.log(` \u2705 [${display.id}] Panel fetched the picture${wake}${battery}${out.slept ? '; put it to sleep' : ''}${out.reason ? ` (${out.reason})` : ''}`);
    else console.log(` \u26A0\uFE0F  [${display.id}] ${out.reason}`);
    return { configured, ...out };
  } catch (err) {
    console.log(` \u26A0\uFE0F  [${display.id}] Push failed: ${err.message}`);
    return { configured, pushed: false, reason: err.message };
  }
}

const controller = createController({
  displays,
  mode: config.REDRAW_MODE,
  layouts: LAYOUT_NAMES,
  themes: THEME_SETTINGS,
  forcePushSeconds: config.REDRAW_MODE === 'auto' ? config.FORCE_PUSH_SECONDS : 0,
  stateFile: config.STATE_FILE,
  renderFor,
  refreshModel: () => { birdCache = { at: 0, promise: null }; },
  deliver,
  panel: { checkBattery, sleep: sleepPanel },
});

function refreshLoop(display) {
  controller.check(display).then(
    ({ pending, sent }) => {
      if (!sent && !pending) console.log(` \u23F8  [${display.id}] Birds unchanged: nothing to draw`);
      else if (!sent) console.log(` \u{1F4CC} [${display.id}] Picture changed: redraw pending (waiting to be told; REDRAW_MODE=${config.REDRAW_MODE})`);
    },
    (err) => console.error(`[refresh:${display.id}] render/push error:`, err),
  );
  setTimeout(() => refreshLoop(display), Math.max(30, display.refreshSeconds) * 1000);
}

// --- Routes --------------------------------------------------------------------------------

const imageType = () => (config.IMAGE_FORMAT === 'png' ? 'image/png' : 'image/jpeg');

function pickDisplay(req, res) {
  const id = String(req.query.display || req.params.display || displays[0].id).toLowerCase();
  const display = displayById.get(id);
  if (!display) res.status(404).json({ error: `Unknown display "${id}". Available: ${displays.map((d) => d.id).join(', ')}` });
  return display;
}

const currentEntry = (display) => {
  const id = currentPush.get(display.id);
  return id ? pendingImages.get(id) : undefined;
};

function serveManifest(req, res, entry, label) {
  if (!entry) return res.status(404).json({ error: 'Not found' });
  console.log(` \u{1F4E5} content.json served for ${label} (${req.ip}, ${req.get('user-agent') || 'no UA'})`);
  res.header('Content-Type', 'application/json');
  // Same quirk as the reference server: forward slashes are escaped in the serialized JSON.
  res.send(JSON.stringify(entry.contentJson).replaceAll('/', '\\/'));
}

function serveImage(req, res, entry, label, { fromPanel = false } = {}) {
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (fromPanel) { // only the manifest's own image URL counts: previews and thumbnails must not
    entry.fetched = true; lastFetchedHash.set(entry.displayId, entry.hash); entry.onFetch?.();
  }
  console.log(` \u{1F4E5} image served for ${label} (${req.ip}, ${req.get('user-agent') || 'no UA'})`);
  res.header('Content-Type', imageType());
  res.header('Cache-Control', 'no-store');
  res.send(entry.imageBuffer);
}

// Render now without touching the panel: /preview?display=<id>&layout=specimen&style=audubon&art=pattern&rotation=90&now=2026-11-03T15:00:00-05:00
app.get('/preview', async (req, res) => {
  const display = pickDisplay(req, res);
  if (!display) return;
  const rotation = req.query.rotation === undefined ? display.rotation : parseInt(req.query.rotation, 10);
  if (![0, 90, 180, 270].includes(rotation)) return res.status(400).json({ error: 'rotation must be 0, 90, 180 or 270' });
  const now = req.query.now ? new Date(String(req.query.now)) : undefined;
  if (now && Number.isNaN(now.getTime())) return res.status(400).json({ error: 'now must be an ISO date-time' });
  try {
    const layout = String(req.query.layout || controller.layoutOf(display.id)).toLowerCase();
    if (!LAYOUT_NAMES.includes(layout)) return res.status(400).json({ error: `layout must be one of ${LAYOUT_NAMES.join(', ')}` });
    const style = String(req.query.style || controller.themeOf(display.id)).toLowerCase();
    if (!THEME_SETTINGS.includes(style)) return res.status(400).json({ error: `style must be one of ${THEME_SETTINGS.join(', ')}` });
    const art = String(req.query.art || config.ART_DITHER).toLowerCase();
    if (!config.ART_MODES.includes(art)) return res.status(400).json({ error: `art must be one of ${config.ART_MODES.join(', ')}` });
    const img = await render(await modelFor(style, layout, { now }), { geometry: geometryOf(display, { rotation }), layout, art });
    res.header('Content-Type', imageType());
    res.header('Cache-Control', 'no-store');
    res.send(img);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/display-content/:id/content.json', (req, res) => serveManifest(req, res, pendingImages.get(req.params.id), req.params.id));
app.get('/api/display-content/:id/image', (req, res) => serveImage(req, res, pendingImages.get(req.params.id), req.params.id, { fromPanel: true }));
app.get('/d/:display/content.json', (req, res) => { const d = pickDisplay(req, res); if (d) serveManifest(req, res, currentEntry(d), d.id); });
app.get('/d/:display/image.jpg', (req, res) => { const d = pickDisplay(req, res); if (d) serveImage(req, res, currentEntry(d), d.id); });
app.get('/content.json', (req, res) => serveManifest(req, res, currentEntry(displays[0]), displays[0].id));
app.get('/image.jpg', (req, res) => serveImage(req, res, currentEntry(displays[0]), displays[0].id));

// --- Control API (the same actions Home Assistant gets over MQTT) -----------------------------------
//   GET  /api/displays/:id/status            the redraw state as JSON
//   POST /api/displays/:id/refresh           look up the birds; redraw only if the picture changed
//   POST /api/displays/:id/redraw            look up the birds; redraw now even if unchanged
//   POST /api/displays/:id/check             look up the birds; update "pending" only
//   POST /api/displays/:id/battery           wake the panel if needed, read its battery, let it sleep again
//   POST /api/displays/:id/sleep             put the panel to sleep (only if it can be woken again)
//   POST /api/displays/:id/layout?name=timeline  switch layout (a change shows as pending)
//   POST /api/displays/:id/theme?name=audubon    switch art style: gould, audubon or engraving
//   GET  /plates                              the painted plates;  POST /api/plates/repaint?species=<Latin name>&style=gould
// There is no authentication: keep this port on a trusted network.
const act = (run) => async (req, res) => {
  const display = pickDisplay(req, res);
  if (!display) return;
  try { res.json({ ok: true, result: await run(display, req), status: controller.status(display.id) }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
};
app.get('/api/displays/:display/status', (req, res) => { const d = pickDisplay(req, res); if (d) res.json(controller.status(d.id)); });
app.post('/api/displays/:display/refresh', act((d) => controller.refresh(d)));
app.post('/api/displays/:display/redraw', act((d) => controller.redraw(d)));
app.post('/api/displays/:display/check', act((d) => controller.check(d, { fresh: true })));
app.post('/api/displays/:display/battery', act((d) => controller.checkBattery(d)));
app.post('/api/displays/:display/sleep', act((d) => controller.sleepPanel(d)));
app.post('/api/displays/:display/layout', act((d, req) => controller.setLayout(d, String(req.query.name || '').toLowerCase())));
app.post('/api/displays/:display/theme', act((d, req) => controller.setTheme(d, String(req.query.name || '').toLowerCase())));

// Older form: redraw now, even if nothing changed. ?display=<id> for one display, otherwise all.
app.post('/refresh', async (req, res) => {
  const targets = req.query.display ? [pickDisplay(req, res)].filter(Boolean) : displays;
  if (!targets.length) return;
  const results = {};
  for (const display of targets) {
    try { results[display.id] = { ok: true, ...(await controller.redraw(display)) }; } catch (err) { results[display.id] = { ok: false, error: err.message }; }
  }
  const ok = Object.values(results).every((r) => r.ok);
  res.status(ok ? 200 : 500).json({ ok, results });
});

app.get('/healthz', (_req, res) => res.send('ok'));

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugOf = (sci) => sci.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

app.get('/plates', async (_req, res) => {
  const items = await plateStore.list();
  const st = plateStore.status();
  res.send(`<html><head><title>Plates</title></head><body style="font-family: Georgia, serif; background:#efe2c4; padding:2rem;">
    <h2>Plates</h2><p>${items.length} painted &middot; ${st.queued} queued${st.working ? ' (painting now)' : ''} &middot; ${st.madeToday}/${config.PLATES_PER_DAY} made today</p>
    ${st.failures.map((f) => `<p style="color:#900">${esc(f.key)}: ${esc(f.reason)}</p>`).join('')}
    <div style="display:flex; flex-wrap:wrap; gap:16px;">${items.map((i) => `<figure style="margin:0; width:240px"><img src="/plates/${esc(i.style)}/${esc(slugOf(i.species))}.png" style="width:240px; background:#cfd9d0; border:1px solid #000"><figcaption><b>${esc(i.common)}</b><br><i>${esc(i.species)}</i><br>${esc(i.style)}, ${esc(i.how)}</figcaption></figure>`).join('')}</div>
  </body></html>`);
});
app.get('/plates/:style/:slug.png', async (req, res) => {
  const bytes = STYLE_NAMES.includes(req.params.style) ? await plateStore.getCutout({ slug: req.params.slug.replace(/[^a-z0-9_]/g, ''), common: req.params.slug }, req.params.style) : null;
  if (!bytes) return res.status(404).json({ error: 'Not found' });
  res.header('Content-Type', 'image/png');
  res.send(bytes);
});
// Throws away a plate and paints it again: POST /api/plates/repaint?species=Thryothorus%20ludovicianus&style=gould
app.post('/api/plates/repaint', async (req, res) => {
  const scientific = String(req.query.species || '').trim();
  const style = String(req.query.style || config.STYLE).toLowerCase();
  if (!scientific || !STYLE_NAMES.includes(style)) return res.status(400).json({ error: `species and a style (${STYLE_NAMES.join(', ')}) are needed` });
  const birds = await currentBirds().catch(() => null);
  const found = birds?.species.find((s) => s.scientific.toLowerCase() === scientific.toLowerCase());
  const species = found ?? { scientific, common: scientific, slug: slugOf(scientific), thumb: '' };
  await plateStore.remove(species, style);
  await plateStore.request([species], style, { force: true });
  res.json({ ok: true, queued: species.scientific, style });
});

app.get('/', (_req, res) => {
  const rows = displays.map((d) => {
    const entry = currentEntry(d);
    const g = geometryOf(d);
    const status = controller.status(d.id);
    return `<tr><td><b>${d.id}</b></td><td>${status.layout} / ${status.theme}</td><td>${d.rotation}&deg; (${g.width}&times;${g.height})</td>
      <td>${mdcConfigured(d) ? `push → ${d.host}` : 'serve-only'}</td><td>${status.pending ? '<b>redraw pending</b>' : 'up to date'}${status.battery ? ` &middot; battery ${status.battery.percent}%${status.battery.source ? ` (${status.battery.source})` : ''}` : ''} &middot; panel ${status.panelState}</td>
      <td>${entry ? new Date(entry.createdAt).toISOString() : 'n/a'}</td>
      <td><a href="/d/${d.id}/image.jpg">image</a> &middot; <a href="/d/${d.id}/content.json">manifest</a> &middot; <a href="/preview?display=${d.id}">preview</a></td></tr>`;
  }).join('');
  res.send(`<html><head><title>Birds</title></head><body style="font-family: monospace; background:#ccc; padding:2rem;">
    <h2>Bird plate display service</h2>
    <p>BirdNET-Go ${esc(config.BIRDNET_URL)} &mdash; images: ${config.IMAGE_BACKEND} &mdash; <a href="/plates">plates</a></p>
    <table cellpadding="6" border="1" style="border-collapse:collapse; background:#fff;">
      <tr><th>display</th><th>layout / style</th><th>rotation</th><th>delivery</th><th>state</th><th>last frame</th><th>links</th></tr>${rows}</table>
    <p>${displays.map((d) => `<a href="/d/${d.id}/image.jpg"><img src="/d/${d.id}/image.jpg?t=${Date.now()}" alt="${d.id}" style="border:2px solid #000; height:640px; margin-right:8px;"></a>`).join('')}</p>
  </body></html>`);
});

/** Warns about a PUBLIC_HOST the panel could not use, and about a content URL the panel would reject. */
function warnAboutPublicUrl() {
  for (const w of publicUrlWarnings(baseUrl(), displays.map((d) => d.host).filter(Boolean))) console.warn(` [config] ${w}`);
}

app.listen(config.PORT, config.HOST, () => {
  console.log('\n\u{1F680} Bird plate display server');
  console.log(` Listening on port ${config.PORT}`);
  console.log(` Panels fetch frames from ${baseUrl()}`);
  console.log(` BirdNET-Go: ${config.BIRDNET_URL}; images: ${config.IMAGE_BACKEND}${config.IMAGE_BACKEND === 'openai' ? ` (${config.IMAGE_API_URL})` : config.IMAGE_BACKEND === 'comfyui' ? ` (${config.COMFY_URL})` : ''}; plates in ${config.PLATE_DIR}; time zone ${config.TIMEZONE}`);
  console.log(` Redraw mode: ${config.REDRAW_MODE}${config.REDRAW_MODE === 'manual' ? ' (the picture is sent only when asked, by Home Assistant or the HTTP API)' : ''}`);
  for (const d of displays) {
    const power = !mdcConfigured(d) ? '' : `; wake ${d.wake ? 'on' : 'off'}, sleep after push ${d.sleepAfterPush ? 'on' : 'off'}${d.batteryCheckHours > 0 ? `, battery check every ${d.batteryCheckHours} h` : ''}`;
    console.log(` Display "${d.id}": layout ${d.layout}, style ${d.theme}, rotation ${d.rotation}, check every ${d.refreshSeconds}s, ${mdcConfigured(d) ? `push → ${d.host}` : 'serve-only'}${power}`);
    if (d.sleepAfterPush && !d.wake) console.warn(` [config] Display "${d.id}": DISPLAY_SLEEP_AFTER_PUSH needs DISPLAY_MAC (a panel that cannot be woken is never put to sleep).`);
  }
  warnAboutPublicUrl();
  if (config.MQTT_URL) {
    startMqtt({ url: config.MQTT_URL, username: config.MQTT_USERNAME, password: config.MQTT_PASSWORD, prefix: config.MQTT_TOPIC_PREFIX, discoveryPrefix: config.MQTT_DISCOVERY_PREFIX, displays, layouts: LAYOUT_NAMES, themes: THEME_SETTINGS, controller });
  }
  displays.forEach((d, i) => setTimeout(() => refreshLoop(d), i * 5000));
  // A battery panel is checked now and then: it wakes briefly, reports its charge and sleeps again.
  displays.forEach((d, i) => {
    if (!mdcConfigured(d) || !(d.batteryCheckHours > 0)) return;
    const run = () => controller.checkBattery(d).then(
      (out) => console.log(` \u{1F50B} [${d.id}] Battery ${out.battery.percent}%${out.battery.source ? ` (${out.battery.source})` : ''}${out.slept ? '; panel asleep again' : ''}`),
      (err) => console.warn(` \u{1F50B} [${d.id}] Battery check failed: ${err.message}`),
    );
    setTimeout(() => { run(); setInterval(run, d.batteryCheckHours * 3600 * 1000); }, 5 * 60 * 1000 + i * 30000);
  });
});
