// Renders both layouts from the plates in PLATE_DIR (or "plate in preparation" cards), with demo birds: node scripts/render-demo.mjs [outdir]
import fs from 'fs/promises';
import path from 'path';
import * as config from '../src/config.mjs';
import { render } from '../src/render.mjs';
import { geometryFor } from '../src/geometry.mjs';
import { speciesSlug } from '../src/birdnet.mjs';
import { cutOut, KEYED } from '../src/cutout.mjs';

const out = process.argv[2] || 'docs/images';
await fs.mkdir(out, { recursive: true });
const mk = (common, scientific, count, firstHeard, extra = {}) => ({ common, scientific, slug: speciesSlug(scientific), count, firstHeard, latestHeard: '13:00:00', ...extra });
const species = [
  mk('Carolina Wren', 'Thryothorus ludovicianus', 120, '06:02:10'), mk('American Crow', 'Corvus brachyrhynchos', 96, '06:20:41'),
  mk('Northern Cardinal', 'Cardinalis cardinalis', 58, '06:31:09'), mk('Blue Jay', 'Cyanocitta cristata', 41, '07:12:55'),
  mk('Tufted Titmouse', 'Baeolophus bicolor', 33, '07:40:02'), mk('Red-shouldered Hawk', 'Buteo lineatus', 30, '11:11:11'),
  mk('Barred Owl', 'Strix varia', 28, '01:03:00'), mk('Eastern Bluebird', 'Sialia sialis', 24, '08:15:00'),
  mk('Mourning Dove', 'Zenaida macroura', 22, '07:01:00'), mk('Fish Crow', 'Corvus ossifragus', 20, '09:30:00'),
  mk('House Finch', 'Haemorhous mexicanus', 18, '10:00:00'), mk('Canada Goose', 'Branta canadensis', 15, '12:00:00'),
];
const plates = new Map(), cutouts = new Map(), notes = new Map();
const cutFile = (sp) => path.join(config.PLATE_DIR, config.STYLE, `${sp.slug}.cut.png`);
for (const sp of species) {
  try {
    const bytes = await fs.readFile(path.join(config.PLATE_DIR, config.STYLE, `${sp.slug}.png`));
    plates.set(sp.slug, bytes);
    cutouts.set(sp.slug, await fs.readFile(cutFile(sp)).catch(async () => cutOut(bytes, KEYED)));
  } catch { /* shows the pending card */ }
  notes.set(sp.slug, 'A small, restless bird of hedge and thicket, whose loud and cheerful song carries far beyond its size.');
}
if (process.env.ONLY_PAINTED) { for (let i = species.length - 1; i >= 0; i--) if (!plates.has(species[i].slug)) species.splice(i, 1); }
const model = { day: '2026-11-22', window: 'today', garden: 'Backyard', style: config.STYLE, species, latest: species[0], plates, cutouts, notes };
for (const layout of ['cluster', 'folio', 'specimen']) {
  await fs.writeFile(path.join(out, `${layout}.png`), await render(model, { geometry: geometryFor(), layout }));
  console.log('wrote', path.join(out, `${layout}.png`));
}
