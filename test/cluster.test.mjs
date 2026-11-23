import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cutOut, KEYED } from '../src/cutout.mjs';
import { packCluster } from '../src/pack.mjs';
import { render, prepare } from '../src/render.mjs';
import { geometryFor } from '../src/geometry.mjs';
import { speciesSlug } from '../src/birdnet.mjs';
import { glowStrength } from '../src/layouts.mjs';
import { STYLE_NAMES, STYLES, toneCutout } from '../src/plates.mjs';
import { agedPaper } from '../src/paper.mjs';
import { createCanvas } from '@napi-rs/canvas';

/** A plate: cream paper with a vignette, and a red ring (a "bird" with a hole of paper in it) in the middle. */
async function fakePlate(size = 240) {
  const raw = Buffer.alloc(size * size * 3);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c) / (size * 0.71);
    const i = (y * size + x) * 3;
    const shade = 1 - 0.12 * d * d; // the paper darkens toward the corners
    raw[i] = 250 * shade; raw[i + 1] = 240 * shade; raw[i + 2] = 218 * shade;
    const r = Math.hypot((x - c) / 60, (y - c) / 40);
    if (r < 1 && r > 0.35) { raw[i] = 170; raw[i + 1] = 40; raw[i + 2] = 30; }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

test('cutOut removes the paper (even with a vignette) and the enclosed scrap, keeps the bird, and trims', async () => {
  const out = await cutOut(await fakePlate());
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.ok(info.width < 240 && info.height < 240, 'trimmed to the bird');
  assert.ok(info.width >= 115 && info.width <= 135, `about the bird's width, got ${info.width}`);
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  assert.equal(alphaAt(1, 1), 0, 'corner is paper');
  assert.equal(alphaAt(Math.round(info.width * 0.12), Math.round(info.height / 2)), 255, 'the bird is opaque');
  assert.equal(alphaAt(info.width >> 1, info.height >> 1), 0, 'the paper inside the ring is gone');
});

test('cutOut refuses a picture that is only paper', async () => {
  const blank = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#f5ecd8' } }).png().toBuffer();
  await assert.rejects(cutOut(blank), /nothing but paper|too small/);
});

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('packCluster: nothing overlaps, everything is on the page, the biggest is in the middle and the group fills the area', () => {
  const items = Array.from({ length: 14 }, (_, i) => ({ key: `b${i}`, aspect: [1.4, 0.8, 1, 1.2][i % 4], labelW: 150 + (i % 5) * 20 }));
  const area = { x: 50, y: 40, w: 1340, h: 2200 };
  const { rects, long } = packCluster(items, area, { gap: 10, labelH: 34, pad: 10, step: 8 });
  assert.equal(rects.length, 14);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    assert.ok(r.x >= area.x - 1 && r.y >= area.y - 1 && r.x + r.w <= area.x + area.w + 1 && r.y + r.h <= area.y + area.h + 1, `rect ${i} on the page`);
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `rects ${i} and ${j} overlap`);
  }
  assert.ok(Math.max(...rects.map((r) => r.dw)) >= long * 0.99 || Math.max(...rects.map((r) => r.dh)) >= long * 0.99);
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const dist = (r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
  assert.ok(dist(rects[0]) <= Math.min(...rects.slice(1).map(dist)) + 1, 'the first (biggest) is the most central');
  const xs = rects.map((r) => r.x), xe = rects.map((r) => r.x + r.w);
  assert.ok(Math.max(...xe) - Math.min(...xs) > area.w * 0.6, 'the group spreads across the page');
});

test('packCluster: one bird is big and centred; none gives nothing; equal sizes are equal', () => {
  const area = { x: 0, y: 0, w: 1000, h: 1600 };
  const one = packCluster([{ key: 'a', aspect: 1, labelW: 100 }], area).rects[0];
  assert.ok(one.dw > 500);
  assert.ok(Math.abs(one.x + one.w / 2 - 500) < 1 && Math.abs(one.y + one.h / 2 - 800) < 1);
  assert.deepEqual(packCluster([], area).rects, []);
  const eq = packCluster([1, 2, 3].map((n) => ({ key: `k${n}`, aspect: 1, labelW: 80 })), area, { equal: true }).rects;
  assert.ok(eq.every((r) => Math.abs(r.dw - eq[0].dw) < 0.01));
});

const species = (common, scientific, count, firstHeard = '06:00:00') => ({ common, scientific, slug: speciesSlug(scientific), count, firstHeard, latestHeard: '12:00:00' });

test('prepare picks the busiest birds, the most heard first, for the cluster', () => {
  const sp = Array.from({ length: 20 }, (_, i) => species(`Bird ${i}`, `Genus sp${i}`, 100 - i));
  const { needed, model } = prepare({ species: sp, latest: sp[3], cutouts: new Map() }, 'cluster');
  assert.ok(needed.length <= 16 && needed[0] === sp[0]);
  assert.deepEqual(model.cluster, needed);
});

test('cluster renders a portrait PNG with cut-outs or placeholders, deterministically, with no clock', async () => {
  const geometry = geometryFor({ width: 720, height: 1280, rotation: 0 });
  const cut = await cutOut(await fakePlate());
  const sp = [species('Carolina Wren', 'Thryothorus ludovicianus', 50), species('Blue Jay', 'Cyanocitta cristata', 20), species('Barred Owl', 'Strix varia', 10)];
  const mk = (withCuts) => ({ day: '2026-11-22', window: 'today', garden: 'Backyard', style: 'gould', species: sp, latest: sp[0], cutouts: new Map(withCuts ? sp.map((s) => [s.slug, cut]) : []), notes: new Map() });
  const a = await render(mk(true), { geometry, layout: 'cluster' });
  const b = await render(mk(true), { geometry, layout: 'cluster' });
  const c = await render(mk(false), { geometry, layout: 'cluster' });
  assert.deepEqual([(await sharp(a).metadata()).width, (await sharp(a).metadata()).height], [720, 1280]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c, 'a landed plate changes the picture');
  const empty = await render({ ...mk(false), species: [], latest: null }, { geometry, layout: 'cluster' });
  assert.ok(empty.length > 1000);
});

test('cutOut on a magenta ground: a pale bird keeps its pale breast, and the ground\'s pink fringe is despilled', async () => {
  const size = 240, c = size / 2;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 3;
    const r = Math.hypot((x - c) / 70, (y - c) / 50);
    const [R, G, B] = r < 1 ? (y > c ? [236, 232, 220] : [40, 90, 170]) : [255, 0, 255]; // a blue back and a cream breast
    raw[i] = R; raw[i + 1] = G; raw[i + 2] = B;
  }
  const out = await cutOut(await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer(), KEYED);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.equal(px(2, 2)[3], 0, 'ground gone');
  const breast = px(info.width >> 1, Math.round(info.height * 0.8));
  assert.equal(breast[3], 255, 'the pale breast is kept');
  assert.ok(breast[0] > 200 && breast[1] > 200, 'and still pale');
  for (let x = 0; x < info.width; x++) for (let y = 0; y < info.height; y++) { // no magenta left on opaque pixels
    const [r, g, b, a] = px(x, y);
    if (a === 255) assert.ok(Math.min(r - g, b - g) < 60, `pink fringe left at ${x},${y}`);
  }
});

test('the cluster page has no hard disc in the middle, in any style (the highlight never snaps to white)', async () => {
  const geometry = geometryFor({ width: 720, height: 1280, rotation: 0 });
  for (const style of STYLE_NAMES) {
    const out = await render({ day: '2026-11-22', window: 'today', garden: 'Backyard', style, species: [], latest: null, cutouts: new Map() }, { geometry, layout: 'cluster' });
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    const aged = Boolean(STYLES[style].look.age);
    const mid = at(360, 440), edge = at(360, 20); // clear of the text lines
    if (!aged) for (let c = 0; c < 3; c++) assert.ok(Math.abs(mid[c] - edge[c]) < 30, `${style}: the middle differs from the edge by ${Math.abs(mid[c] - edge[c])}`);
    if (aged) continue; // aged paper is mottled on purpose; its highlight is never drawn
    // walk across the middle: no jump between neighbouring pixels (a snapped disc has a hard edge)
    let jump = 0;
    for (let x = 1; x < info.width; x++) jump = Math.max(jump, Math.abs(at(x, 440)[1] - at(x - 1, 440)[1]));
    assert.ok(jump <= 4, `${style}: a hard edge of ${jump} across the page`);
  }
});

test('glowStrength: strong on sage, none on very light paper', () => {
  assert.ok(glowStrength('#cfd9d0') > 0.15);
  assert.ok(glowStrength('#ece6d3') < 0.02);
  assert.equal(glowStrength('#ffffff'), 0);
});

test('scene layout: falls back to the cluster without a picture; with one it draws it and still letters the names', async () => {
  const { composeScene, scenePrompt } = await import('../src/scene.mjs');
  const geometry = geometryFor({ width: 720, height: 1280, rotation: 0 });
  const cut = await cutOut(await fakePlate());
  const sp = [species('Carolina Wren', 'Thryothorus ludovicianus', 50), species('Blue Jay', 'Cyanocitta cristata', 20)];
  const model = { day: '2026-11-22', window: 'today', garden: 'Backyard', style: 'gould', species: sp, latest: sp[0], cutouts: new Map(sp.map((s) => [s.slug, cut])), notes: new Map() };
  const composed = await composeScene(model, { geometry, width: 432 });
  assert.deepEqual([composed.width % 16, composed.height % 16], [0, 0]);
  assert.equal(composed.plan.rects.length, 2);
  const meta = await sharp(composed.png).metadata();
  assert.deepEqual([meta.width, meta.height], [composed.width, composed.height]);
  const without = await render(model, { geometry, layout: 'scene' });
  assert.deepEqual(without, await render(model, { geometry, layout: 'cluster' }), 'no scene picture: the cluster');
  const painted = await sharp({ create: { width: composed.width, height: composed.height, channels: 3, background: '#a0b090' } }).png().toBuffer();
  const withScene = await render({ ...model, scene: painted }, { geometry, layout: 'scene' });
  assert.notDeepEqual(withScene, without);
  assert.match(scenePrompt('gould'), /Do not move/);
});

test('agedPaper is deterministic, darker toward the edges, and flecked', () => {
  const draw = (strength) => { const c = createCanvas(400, 600), x = c.getContext('2d'); agedPaper(x, 400, 600, { base: '#e3d3ab', strength }); return { c, x }; };
  const a = draw(1), b = draw(1), none = draw(0);
  assert.ok(a.c.toBuffer('image/png').equals(b.c.toBuffer('image/png')), 'the same sheet every time');
  assert.ok(!a.c.toBuffer('image/png').equals(none.c.toBuffer('image/png')));
  const lum = (x, px, py) => { const d = x.getImageData(px, py, 1, 1).data; return d[0] + d[1] + d[2]; };
  let edge = 0, mid = 0;
  for (let i = 0; i < 40; i++) { edge += lum(a.x, 2, 20 + i * 12) + lum(a.x, 397, 20 + i * 12); mid += lum(a.x, 190 + (i % 8) * 3, 200 + i * 8); }
  assert.ok(edge / 80 < mid / 40 - 15, 'toned darker toward the edges');
});

test('toneCutout fades and warms the colours but leaves the alpha alone', async () => {
  const src = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 20, g: 90, b: 200, alpha: 0.5 } } }).png().toBuffer();
  const out = await toneCutout(src, { saturation: 0.8, fade: 0.1, warm: [1, 0.975, 0.9] });
  const a = await sharp(src).ensureAlpha().raw().toBuffer(), b = await sharp(out).ensureAlpha().raw().toBuffer();
  assert.equal(b[3], a[3], 'alpha kept');
  assert.ok(b[2] < a[2] && b[0] > a[0], 'blue is less saturated and warmer');
});
