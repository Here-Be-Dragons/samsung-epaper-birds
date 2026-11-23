// Paints a set of birds in several styles (kept in PLATE_DIR, so they are reused if you pick that style) and renders one cluster page per
// style to data/samples/: node --env-file=.env scripts/render-samples.mjs [style ...]
import fs from 'fs/promises';
import * as config from '../src/config.mjs';
import { createImageClient } from '../src/imagegen.mjs';
import { createPlateStore, STYLE_NAMES } from '../src/plates.mjs';
import { render } from '../src/render.mjs';
import { geometryFor } from '../src/geometry.mjs';
import { speciesSlug, dayKey } from '../src/birdnet.mjs';

const styles = process.argv.slice(2).length ? process.argv.slice(2) : ['engraving', 'woodblock', 'midcentury'];
for (const s of styles) if (!STYLE_NAMES.includes(s)) throw new Error(`unknown style ${s}; available: ${STYLE_NAMES.join(', ')}`);
const BIRDS = [
  ['Red-shouldered Hawk', 'Buteo lineatus', 89], ['Great Horned Owl', 'Bubo virginianus', 77], ['American Crow', 'Corvus brachyrhynchos', 75],
  ['Eastern Bluebird', 'Sialia sialis', 40], ['Baltimore Oriole', 'Icterus galbula', 30], ['Canada Goose', 'Branta canadensis', 25],
  ['Blue Jay', 'Cyanocitta cristata', 20], ['Carolina Wren', 'Thryothorus ludovicianus', 15],
];
const species = BIRDS.map(([common, scientific, count], i) => ({ common, scientific, slug: speciesSlug(scientific), count, firstHeard: `0${6 + i}:00:00`, latestHeard: '12:00:00', thumb: `/api/v2/media/image/${encodeURIComponent(scientific)}` }));
const store = createPlateStore({ client: createImageClient(), perDay: 999 });
await fs.mkdir('data/samples', { recursive: true });

for (const style of styles) {
  for (const sp of species) {
    if (await store.getPlate(sp, style)) continue;
    const t = Date.now();
    try { const how = await store.paint(sp, style); console.log(`[${style}] ${sp.common}: ${how}, ${Math.round((Date.now() - t) / 1000)}s`); }
    catch (err) { console.log(`[${style}] ${sp.common}: FAILED ${err.message}`); }
  }
  const cutouts = new Map();
  for (const sp of species) { const c = await store.getCutout(sp, style); if (c) cutouts.set(sp.slug, c); }
  const model = { day: dayKey(), window: 'today', garden: config.GARDEN_NAME, style, species, latest: species[0], cutouts, notes: new Map() };
  await fs.writeFile(`data/samples/${style}.png`, await render(model, { geometry: geometryFor(), layout: 'cluster' }));
  console.log(`[${style}] wrote data/samples/${style}.png (${cutouts.size}/${species.length} birds)`);
}
