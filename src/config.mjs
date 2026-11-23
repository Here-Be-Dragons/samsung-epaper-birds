import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function int(name, fallback) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}
function num(name, fallback) {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(n) ? n : fallback;
}
function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}
const str = (name, fallback = '') => (process.env[name] ?? fallback).trim();
const url = (name, fallback = '') => str(name, fallback).replace(/\/+$/, '');

export const TIMEZONE = str('TIMEZONE', 'America/New_York');

// --- Cadence ------------------------------------------------------------------------
// How often the birds are looked up and a frame rendered. The panel flashes on every push, so this is long.
export const REFRESH_INTERVAL_SECONDS = int('REFRESH_INTERVAL_SECONDS', 1800);
// In REDRAW_MODE=auto the panel is redrawn only when the picture changed, but at least this often.
export const FORCE_PUSH_SECONDS = int('FORCE_PUSH_SECONDS', 24 * 3600);
export const REDRAW_MODE = str('REDRAW_MODE', 'auto').toLowerCase();
if (!['auto', 'manual'].includes(REDRAW_MODE)) throw new Error('REDRAW_MODE must be auto or manual');
export const STATE_FILE = str('STATE_FILE');

// --- Panel / image geometry ---------------------------------------------------------
export const PANEL_WIDTH = int('PANEL_WIDTH', 1440);
export const PANEL_HEIGHT = int('PANEL_HEIGHT', 2560);
export const OUTPUT_ROTATION = int('OUTPUT_ROTATION', 0);
export const IMAGE_FORMAT = str('IMAGE_FORMAT', 'png').toLowerCase();
export const JPEG_QUALITY = int('JPEG_QUALITY', 100);
export const PANEL_PALETTE = (() => {
  if (!process.env.PANEL_PALETTE) return null;
  try { return JSON.parse(process.env.PANEL_PALETTE); } catch { throw new Error('PANEL_PALETTE must be JSON like {"red":"#8a1c0c"}'); }
})();
export const ART_MODES = ['panel', 'pattern', 'diffusion'];
export const ART_DITHER = str('ART_DITHER', 'panel').toLowerCase();
if (!ART_MODES.includes(ART_DITHER)) throw new Error(`ART_DITHER must be one of ${ART_MODES.join(', ')}`);
export const TEXT_MODES = ['panel', 'threshold', 'dither'];
export const TEXT_AA = str('TEXT_AA', 'panel').toLowerCase();
if (!TEXT_MODES.includes(TEXT_AA)) throw new Error(`TEXT_AA must be one of ${TEXT_MODES.join(', ')}`);
export const TEXT_CUT = Math.min(0.95, Math.max(0.05, Number(process.env.TEXT_CUT) || 0.4));

// --- HTTP server ----------------------------------------------------------------------
export const HOST = str('HOST', '0.0.0.0');
export const PORT = int('PORT', 8080);
export const PUBLIC_HOST = str('PUBLIC_HOST');
export const PUBLIC_URL = url('PUBLIC_URL');
export const FONT_DIR = path.join(__dirname, '..', 'fonts');

// --- BirdNET-Go -------------------------------------------------------------------------
export const BIRDNET_URL = url('BIRDNET_URL', 'http://192.168.1.10:8086');
export const BIRDNET_TOKEN = str('BIRDNET_TOKEN');
// A species is shown only if it was heard at least this many times today, and once at this confidence or better.
export const MIN_DETECTIONS = int('MIN_DETECTIONS', 2);
export const MIN_CONFIDENCE = num('MIN_CONFIDENCE', 0.6);
// If nothing qualifies today, fall back to the best of the last N days (a quiet morning still shows a bird).
export const FALLBACK_DAYS = int('FALLBACK_DAYS', 7);
// The bird the folio layout features: latest (the one heard last) | top (the most heard today).
export const FEATURE = str('FEATURE', 'latest').toLowerCase();
if (!['latest', 'top'].includes(FEATURE)) throw new Error('FEATURE must be latest or top');
export const GARDEN_NAME = str('GARDEN_NAME', 'The Garden');

// --- Images: FLUX.2 ----------------------------------------------------------------------
// openai:  an OpenAI-compatible server with POST /v1/images/generations and /v1/images/edits
// comfyui: a ComfyUI server running FLUX.2 (the way FLUX.2 is usually served at home)
export const IMAGE_BACKEND = str('IMAGE_BACKEND', 'openai').toLowerCase();
if (!['openai', 'comfyui', 'none'].includes(IMAGE_BACKEND)) throw new Error('IMAGE_BACKEND must be openai, comfyui or none');
export const IMAGE_API_URL = url('IMAGE_API_URL', 'http://192.168.1.249:8000/v1');
export const IMAGE_API_KEY = str('IMAGE_API_KEY');
export const IMAGE_MODEL = str('IMAGE_MODEL', 'flux.2');
export const COMFY_URL = url('COMFY_URL', 'http://192.168.1.249:8188');
export const COMFY_UNET = str('COMFY_UNET', 'flux2_dev_fp8mixed.safetensors');
export const COMFY_CLIP = str('COMFY_CLIP', 'mistral_3_small_flux2_fp8.safetensors');
export const COMFY_VAE = str('COMFY_VAE', 'flux2-vae.safetensors');
export const IMAGE_STEPS = int('IMAGE_STEPS', 20);
export const IMAGE_GUIDANCE = num('IMAGE_GUIDANCE', 4);
export const PLATE_WIDTH = int('PLATE_WIDTH', 1024);
export const PLATE_HEIGHT = int('PLATE_HEIGHT', 1024);
export const IMAGE_TIMEOUT_SECONDS = int('IMAGE_TIMEOUT_SECONDS', 600);
// How a plate is made: edit (repaint BirdNET-Go's reference photo, so the field marks are right), text (from the name alone),
// auto (edit when a photo exists, else text).
export const PLATE_MODE = str('PLATE_MODE', 'auto').toLowerCase();
if (!['auto', 'edit', 'text'].includes(PLATE_MODE)) throw new Error('PLATE_MODE must be auto, edit or text');
export const PLATES_PER_DAY = int('PLATES_PER_DAY', 24);
export const PLATE_DIR = str('PLATE_DIR', path.join(__dirname, '..', 'data', 'plates'));
export const STYLE = str('STYLE', 'gould').toLowerCase();

// --- Text: the local OpenAI-compatible chat model writes each plate's field note ---------------
export const LLM_URL = url('LLM_URL', 'http://192.168.1.249:8000/v1');
export const LLM_API_KEY = str('LLM_API_KEY');
export const LLM_MODEL = str('LLM_MODEL');
// Only the folio layout shows them, so they are off unless asked for.
export const NOTES = bool('NOTES', false);

// --- Home Assistant over MQTT ----------------------------------------------------------------
export const MQTT_URL = str('MQTT_URL');
export const MQTT_USERNAME = str('MQTT_USERNAME');
export const MQTT_PASSWORD = str('MQTT_PASSWORD');
export const MQTT_DISCOVERY_PREFIX = url('MQTT_DISCOVERY_PREFIX', 'homeassistant');
export const MQTT_TOPIC_PREFIX = url('MQTT_TOPIC_PREFIX', 'samsung-epaper-birds');

export const LAYOUT = str('LAYOUT', 'cluster').toLowerCase();
// The cluster page: how many birds, how their sizes are chosen (calls: the most heard biggest | equal), and the page's paper.
export const MAX_BIRDS = Math.max(1, int('MAX_BIRDS', 16));
export const SIZE_BY = str('SIZE_BY', 'calls').toLowerCase();
if (!['calls', 'equal'].includes(SIZE_BY)) throw new Error('SIZE_BY must be calls or equal');
// The cluster page's colour; empty means the style's own (plates.mjs STYLES[...].look.paper).
export const CLUSTER_PAPER = str('CLUSTER_PAPER', '');

// --- Displays (same settings as the calendar container) -------------------------------------
const envSlug = (id) => id.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
function buildDisplay(id, named, read) {
  const get = (name, fallback = '') => (read(name) === undefined ? fallback : String(read(name)));
  const number = (name, fallback) => {
    const n = parseInt(String(read(name) ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const rotation = ((number('ROTATION', OUTPUT_ROTATION) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error(`Display "${id}": ROTATION must be 0, 90, 180 or 270`);
  const flag = (name, fallback) => {
    const v = read(name);
    return v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  };
  const mac = get('MAC').trim();
  const wake = flag('WAKE', Boolean(mac));
  return {
    id: id.toLowerCase(),
    host: get('HOST'),
    pin: named ? get('PIN', process.env.DISPLAY_PIN ?? '') : get('PIN'),
    mac,
    rotation,
    layout: (get('LAYOUT', LAYOUT) || LAYOUT).toLowerCase(),
    theme: (get('STYLE', STYLE) || STYLE).toLowerCase(),
    width: named ? number('WIDTH', PANEL_WIDTH) : PANEL_WIDTH,
    height: named ? number('HEIGHT', PANEL_HEIGHT) : PANEL_HEIGHT,
    refreshSeconds: named ? number('REFRESH_INTERVAL_SECONDS', REFRESH_INTERVAL_SECONDS) : REFRESH_INTERVAL_SECONDS,
    mdcPort: number('MDC_PORT', 1515),
    wake,
    broadcast: get('BROADCAST').trim(),
    wakeTimeoutSeconds: number('WAKE_TIMEOUT_SECONDS', 45),
    fetchTimeoutSeconds: number('FETCH_TIMEOUT_SECONDS', 60),
    sleepAfterPush: flag('SLEEP_AFTER_PUSH', false),
    sleepOnExternalPower: flag('SLEEP_ON_EXTERNAL_POWER', false),
    panelSleepsAfterContent: flag('PANEL_SLEEPS_AFTER_CONTENT', false),
    settleSeconds: number('SETTLE_SECONDS', 45),
    batteryCheckHours: number('BATTERY_CHECK_HOURS', wake ? 24 : 0),
    autoSleepMinutes: number('AUTO_SLEEP_MINUTES', 20),
  };
}
function displaysFromEnv() {
  const ids = (process.env.DISPLAYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const read = (id, named) => (name) => process.env[named ? `DISPLAY_${envSlug(id)}_${name}` : `DISPLAY_${name}`];
  return ids.length ? ids.map((id) => buildDisplay(id, true, read(id, true))) : [buildDisplay('main', false, read('main', false))];
}
export const DISPLAYS = displaysFromEnv();
if (new Set(DISPLAYS.map((d) => d.id)).size !== DISPLAYS.length) throw new Error('DISPLAYS contains duplicate ids');
export const MDC_PUSH_ENABLED = bool('MDC_PUSH_ENABLED', DISPLAYS.some((d) => d.host));
