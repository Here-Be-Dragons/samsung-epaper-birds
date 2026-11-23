// Renders today's cluster page in a style from the plates on disk, without touching the panel: node --env-file=.env scripts/render-today.mjs <style> [out.png]
import fs from 'fs/promises';
import * as config from '../src/config.mjs';
import { createPlateStore } from '../src/plates.mjs';
import { getBirds } from '../src/birdnet.mjs';
import { render } from '../src/render.mjs';
import { geometryFor } from '../src/geometry.mjs';

const style = process.argv[2] || config.STYLE;
const out = process.argv[3] || `data/samples/${style}-today.png`;
const store = createPlateStore({ client: null });
const birds = await getBirds();
const cutouts = new Map();
for (const sp of birds.species.slice(0, config.MAX_BIRDS)) { const c = await store.getCutout(sp, style); if (c) cutouts.set(sp.slug, c); }
await fs.mkdir('data/samples', { recursive: true });
const png = await render({ ...birds, garden: config.GARDEN_NAME, style, cutouts, notes: new Map() }, { geometry: geometryFor(), layout: 'cluster' });
await fs.writeFile(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB, ${cutouts.size}/${Math.min(config.MAX_BIRDS, birds.species.length)} birds with plates)`);
