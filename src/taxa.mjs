/**
 * What kind of animal a detection is. BirdNET-Go 3 and Perch 2 report frogs, insects and mammals as well as birds, and a plate
 * is painted differently for each (a frog does not perch on a sprig). The group comes from GBIF's name match, which is sent only the
 * scientific name; it is looked up once per species and kept beside the plates. When the lookup is off or fails, the group is unknown
 * and the prompt says plainly "animal", which works for any of them (the reference photograph shows what it is).
 */
import fs from 'fs/promises';
import path from 'path';
import * as config from './config.mjs';

export const TAXA = {
  bird: {
    noun: 'bird', article: 'a',
    pose: 'perched on a small sprig of leaves, whole body visible in side profile, accurate plumage and field marks',
    perch: 'a short natural perch: a twig with a few leaves',
  },
  mammal: {
    noun: 'mammal', article: 'a',
    pose: 'standing or sitting in a natural pose, whole body visible in profile, accurate fur and markings',
    perch: 'a small tuft of grass, a mossy stone or a fallen branch',
  },
  frog: {
    noun: 'frog', article: 'a',
    pose: 'sitting on a lily pad or a mossy log, whole body visible, accurate skin pattern and markings',
    perch: 'a lily pad, a mossy log or a stone, with a few reeds or leaves',
  },
  amphibian: {
    noun: 'amphibian', article: 'an',
    pose: 'resting on a mossy log or leaf, whole body visible in profile, accurate skin pattern and markings',
    perch: 'a mossy log, a stone or a few leaves',
  },
  reptile: {
    noun: 'reptile', article: 'a',
    pose: 'resting on a rock or log, whole body visible in profile, accurate scales and markings',
    perch: 'a flat rock, a log or a few leaves',
  },
  insect: {
    noun: 'insect', article: 'an',
    pose: 'shown as a natural history specimen plate, whole body visible with wings and legs spread clearly, accurate markings',
    perch: 'a leaf or a stem of a plant',
  },
  arachnid: {
    noun: 'spider', article: 'a',
    pose: 'shown as a natural history specimen plate, whole body and all legs visible, accurate markings',
    perch: 'a leaf or a stem of a plant',
  },
  other: {
    noun: 'animal', article: 'an',
    pose: 'in a natural pose, whole body visible in profile, accurate colours and markings',
    perch: 'whatever small natural perch or ground it rests on in the photograph',
  },
};

/** The group for GBIF's match, or 'other' for an animal that is none of the above; null for a non-animal. */
export function groupFromGbif(m) {
  if (!m || m.matchType === 'NONE') return null;
  if (m.kingdom && m.kingdom !== 'Animalia') return null;
  switch (m.class) {
    case 'Aves': return 'bird';
    case 'Mammalia': return 'mammal';
    case 'Amphibia': return m.order === 'Anura' ? 'frog' : 'amphibian';
    case 'Reptilia': return 'reptile';
    case 'Insecta': return 'insect';
    case 'Arachnida': return 'arachnid';
    default: return 'other';
  }
}

/** The group to paint for. Unknown means "animal" while lookups are on (the lookup failed), and "bird" when they are off by choice. */
export const taxonOf = (species) => (TAXA[species?.taxon] ? species.taxon : (config.TAXON_LOOKUP ? 'other' : 'bird'));

export function createTaxonomy({ dir = config.PLATE_DIR, enabled = config.TAXON_LOOKUP, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const file = path.join(dir, 'taxa.json');
  let cache = null, loading = null;
  const pending = new Map();
  // One shared read: species are looked up in parallel, and each must see (and add to) the same object.
  const load = () => (loading ??= fs.readFile(file, 'utf8').then((t) => JSON.parse(t), () => ({})).then((c) => (cache = c)));

  /** 'bird' | 'mammal' | ... | 'other', or null when it could not be told (offline, lookup off, not an animal: see `known`). */
  async function lookup(scientific) {
    const c = await load();
    if (scientific in c) return c[scientific];
    if (!enabled) return undefined;
    if (pending.has(scientific)) return pending.get(scientific);
    const job = (async () => {
      try {
        const res = await fetchImpl(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientific)}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return undefined;
        const group = groupFromGbif(await res.json());
        c[scientific] = group; // null (not an animal) is kept too
        try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, JSON.stringify(c, null, 1)); } catch { /* the answer still stands this run */ }
        return group;
      } catch { return undefined; } finally { pending.delete(scientific); }
    })();
    pending.set(scientific, job);
    return job;
  }

  /** Adds `taxon` to each species (left unset when unknown) and drops the ones that are not animals. */
  async function annotate(list) {
    const out = [];
    await Promise.all(list.map(async (s) => {
      const g = await lookup(s.scientific);
      if (g === null) return; // GBIF says it is not an animal
      if (g) s.taxon = g;
    }));
    for (const s of list) {
      const g = cache?.[s.scientific];
      if (g !== null) out.push(s);
    }
    return out;
  }
  return { lookup, annotate };
}
