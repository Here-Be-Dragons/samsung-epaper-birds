// Scene mode prototype: node --env-file=.env scripts/scene-prototype.mjs [style] [birds]   (writes data/samples/scene-<style>-*.png)
import fs from 'fs/promises';
import * as config from '../src/config.mjs';
import { createImageClient } from '../src/imagegen.mjs';
import { createPlateStore } from '../src/plates.mjs';
import { render } from '../src/render.mjs';
import { composeScene, paintScene } from '../src/scene.mjs';
import { geometryFor } from '../src/geometry.mjs';
import { speciesSlug, dayKey } from '../src/birdnet.mjs';

const style = process.argv[2] || 'gould';
const n = Number(process.argv[3] || 8);
const BIRDS = [
  ['Red-shouldered Hawk', 'Buteo lineatus', 89], ['Great Horned Owl', 'Bubo virginianus', 77], ['American Crow', 'Corvus brachyrhynchos', 75],
  ['Eastern Bluebird', 'Sialia sialis', 40], ['Baltimore Oriole', 'Icterus galbula', 30], ['Canada Goose', 'Branta canadensis', 25],
  ['Blue Jay', 'Cyanocitta cristata', 20], ['Carolina Wren', 'Thryothorus ludovicianus', 15],
].slice(0, n);
const species = BIRDS.map(([common, scientific, count], i) => ({ common, scientific, slug: speciesSlug(scientific), count, firstHeard: `0${6 + i}:00:00`, latestHeard: '12:00:00' }));
const store = createPlateStore({ client: null });
const cutouts = new Map();
for (const sp of species) { const c = await store.getCutout(sp, style); if (!c) throw new Error(`no ${style} plate for ${sp.common}`); cutouts.set(sp.slug, c); }
const model = { day: dayKey(), window: 'today', garden: config.GARDEN_NAME, style, species, latest: species[0], cutouts, notes: new Map() };
const geometry = geometryFor();
const out = (name) => `data/samples/scene-${style}-${name}.png`;
await fs.mkdir('data/samples', { recursive: true });

const composed = await composeScene(model, { geometry });
await fs.writeFile(out('1-composed'), composed.png);
console.log(`composed ${composed.width}x${composed.height}`);
const t = Date.now();
const painted = await paintScene(createImageClient(), composed.png, style, { width: composed.width, height: composed.height, seed: 7 });
console.log(`FLUX.2 pass: ${Math.round((Date.now() - t) / 1000)}s`);
await fs.writeFile(out('2-flux'), painted);
await fs.writeFile(out('3-page'), await render({ ...model, scene: painted }, { geometry, layout: 'scene' }));
await fs.writeFile(out('0-cluster'), await render(model, { geometry, layout: 'cluster' }));
console.log('wrote', out('0-cluster'), out('1-composed'), out('2-flux'), out('3-page'));
