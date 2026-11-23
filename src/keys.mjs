/**
 * The key colour a plate is painted on. A plate is cut out by finding the ground it was painted on, so the ground must be a colour the
 * animal does not wear: magenta suits most, but a pigeon's pink sheen or a cardinal's red is close to it and gets cut away. So the colour
 * is chosen per animal, from the reference photo: whichever candidate has the least of its hue (and saturation) in the middle of the picture.
 */
import sharp from 'sharp';

export const KEY_COLOURS = [
  { name: 'magenta', hex: '#FF00FF', hue: 300 },
  { name: 'cyan', hex: '#00FFFF', hue: 180 },
  { name: 'lime green', hex: '#00FF00', hue: 120 },
  { name: 'blue', hex: '#0000FF', hue: 240 },
];

export const keyByHex = (hex) => KEY_COLOURS.find((k) => k.hex.toLowerCase() === String(hex || '').toLowerCase()) || KEY_COLOURS[0];

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max / 255 };
}

/** The candidate whose hue the photographed animal wears least (ties go to the earlier candidate: magenta first). No photo: magenta. */
export async function pickKey(photo) {
  if (!photo) return KEY_COLOURS[0];
  try {
    const n = 48;
    const { data } = await sharp(photo).removeAlpha().resize(n, n, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
    const lo = Math.round(n * 0.2), hi = Math.round(n * 0.8); // the middle: the edges are the photo's own background, which is replaced
    const score = KEY_COLOURS.map(() => 0);
    for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
      const i = (y * n + x) * 3;
      const { h, s, v } = hsv(data[i], data[i + 1], data[i + 2]);
      if (s < 0.18 || v < 0.2) continue; // greys and darks wear no key colour
      KEY_COLOURS.forEach((k, j) => {
        const d = Math.min(Math.abs(h - k.hue), 360 - Math.abs(h - k.hue));
        if (d <= 45) score[j] += s * (1 - d / 60);
      });
    }
    let best = 0;
    for (let j = 1; j < score.length; j++) if (score[j] < score[best] - 1e-9) best = j;
    return KEY_COLOURS[best];
  } catch { return KEY_COLOURS[0]; }
}
