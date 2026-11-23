// Paints one plate now, to try a style or a backend: node --env-file=.env scripts/make-plate.mjs "Carolina Wren" "Thryothorus ludovicianus" [style]
import fs from 'fs/promises';
import { createImageClient } from '../src/imagegen.mjs';
import { createPlateStore, createNoteWriter, STYLE_NAMES } from '../src/plates.mjs';
import { speciesSlug } from '../src/birdnet.mjs';
import * as config from '../src/config.mjs';

const [common = 'Carolina Wren', scientific = 'Thryothorus ludovicianus', style = config.STYLE] = process.argv.slice(2);
if (!STYLE_NAMES.includes(style)) throw new Error(`style must be one of ${STYLE_NAMES.join(', ')}`);
const client = createImageClient();
if (!client) throw new Error('IMAGE_BACKEND is none');
const store = createPlateStore({ client, llm: config.NOTES ? createNoteWriter() : null });
const species = { common, scientific, slug: speciesSlug(scientific), thumb: '' };
const how = await store.paint(species, style);
console.log(`painted (${how}) -> ${config.PLATE_DIR}/${style}/${species.slug}.png`);
