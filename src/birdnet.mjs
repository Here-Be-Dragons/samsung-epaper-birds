/**
 * BirdNET-Go's v2 API: today's species (with counts, hours and first/latest heard), and the species thumbnails
 * used as a reference for the painter. Reads are public in BirdNET-Go; a token is only for a proxy that wants one.
 */
import * as config from './config.mjs';
import { createTaxonomy } from './taxa.mjs';

const headers = () => (config.BIRDNET_TOKEN ? { Authorization: `Bearer ${config.BIRDNET_TOKEN}` } : {});

async function getJson(path, { timeoutMs = 15000 } = {}) {
  const res = await fetch(`${config.BIRDNET_URL}${path}`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`BirdNET-Go ${path.split('?')[0]} answered ${res.status}`);
  return res.json();
}

/** "YYYY-MM-DD" in the configured zone. */
export function dayKey(date = new Date(), timeZone = config.TIMEZONE) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const slug = (sci) => sci.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const speciesSlug = slug;

/** Normalises a /analytics/species/daily row. */
function fromDaily(r) {
  return {
    scientific: r.scientific_name, common: r.common_name, slug: slug(r.scientific_name), code: r.species_code,
    count: r.count ?? 0, hourly: r.hourly_counts ?? [], maxConfidence: r.max_confidence ?? 0,
    firstHeard: r.first_heard ?? '', latestHeard: r.latest_heard ?? '', thumb: r.thumbnail_url ?? '',
    daysSeen: r.days_this_year ?? null, newToday: r.days_since_first_seen === 0,
  };
}
/** Normalises a /analytics/species/summary row (a longer window: first/last are timestamps). */
function fromSummary(r) {
  const t = (s) => (s ? s.slice(11, 19) : '');
  return {
    scientific: r.scientific_name, common: r.common_name, slug: slug(r.scientific_name), code: r.species_code,
    count: r.count ?? 0, hourly: [], maxConfidence: r.max_confidence ?? 0,
    firstHeard: t(r.first_heard), latestHeard: t(r.last_heard), lastHeardAt: r.last_heard ?? '', thumb: r.thumbnail_url ?? '',
  };
}

/**
 * The birds to show: today's species that pass the filters, or (when none does) the recent past.
 * Returns { day, window, species (busiest first), latest (the one heard last), ok }.
 */
/** A label that is not wildlife (a person, an engine...), by the whole common or scientific name; labels like "Dog_Dog" count as "dog". */
export function isExcluded(s, list = config.EXCLUDE) {
  const names = [s.common, s.scientific].filter(Boolean).map((n) => String(n).toLowerCase().trim());
  return names.some((n) => list.includes(n) || list.includes(n.split('_')[0]));
}

let taxonomy = null;

export async function getBirds({ now = new Date() } = {}) {
  const day = dayKey(now);
  const keep = (s) => s.count >= config.MIN_DETECTIONS && s.maxConfidence >= config.MIN_CONFIDENCE && !isExcluded(s);
  const daily = (await getJson(`/api/v2/analytics/species/daily?date=${day}`)).map(fromDaily).filter(keep);
  let species = daily, window = 'today';
  if (!species.length && config.FALLBACK_DAYS > 0) {
    const start = dayKey(new Date(now.getTime() - config.FALLBACK_DAYS * 86400000));
    const rows = await getJson(`/api/v2/analytics/species/summary?start_date=${start}&end_date=${day}`);
    species = rows.map(fromSummary).filter(keep);
    window = `the last ${config.FALLBACK_DAYS} days`;
  }
  taxonomy ??= createTaxonomy();
  species = await taxonomy.annotate(species); // adds the kind of animal; drops what GBIF says is not one
  species.sort((a, b) => b.count - a.count || a.scientific.localeCompare(b.scientific));
  const latest = [...species].sort((a, b) => b.latestHeard.localeCompare(a.latestHeard) || b.count - a.count)[0] ?? null;
  return { day, window, species, latest, ok: true };
}

/** The reference photo BirdNET-Go keeps for a species (JPEG/PNG bytes), or null. */
export async function fetchThumbnail(species) {
  const path = species.thumb || `/api/v2/media/image/${encodeURIComponent(species.scientific)}`;
  try {
    const res = await fetch(`${config.BIRDNET_URL}${path}`, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok || !String(res.headers.get('content-type') || '').startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 500 ? buf : null;
  } catch { return null; }
}
