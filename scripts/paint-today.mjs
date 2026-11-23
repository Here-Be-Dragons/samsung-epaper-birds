// Paints today's birds (the ones the cluster page shows) in a style, so the page has no placeholders: node --env-file=.env scripts/paint-today.mjs <style>
import * as config from '../src/config.mjs';
import { createImageClient } from '../src/imagegen.mjs';
import { createPlateStore, STYLE_NAMES } from '../src/plates.mjs';
import { getBirds } from '../src/birdnet.mjs';

const style = process.argv[2];
if (!STYLE_NAMES.includes(style)) throw new Error(`style must be one of ${STYLE_NAMES.join(', ')}`);
const store = createPlateStore({ client: createImageClient(), perDay: 999 });
const { species } = await getBirds();
const todo = species.slice(0, config.MAX_BIRDS);
let n = 0;
for (const sp of todo) {
  if (await store.getCutout(sp, style)) { n++; continue; }
  const t = Date.now();
  try { const how = await store.paint(sp, style); n++; console.log(`[${style}] ${sp.common}: ${how}, ${Math.round((Date.now() - t) / 1000)}s`); }
  catch (err) { console.log(`[${style}] ${sp.common}: FAILED ${err.message}`); }
}
console.log(`done: ${n}/${todo.length} birds have plates in ${style}`);
