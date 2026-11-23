/**
 * FLUX.2 text-to-image and image editing behind two interchangeable backends:
 *   openai   POST {IMAGE_API_URL}/images/generations and /images/edits (the OpenAI images API)
 *   comfyui  a ComfyUI server running FLUX.2 (text-to-image, or a reference-image edit through ReferenceLatent)
 * Both give back image bytes. A client is { generate(prompt, opts), edit(image, prompt, opts), name }.
 */
import * as config from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sniff = (buf) => (buf[0] === 0xff ? 'image/jpeg' : buf[0] === 0x52 ? 'image/webp' : 'image/png');

async function readImageResponse(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} answered ${res.status}: ${text.slice(0, 200)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${what} did not answer JSON`); }
  const item = body?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!img.ok) throw new Error(`${what}: fetching ${item.url} answered ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error(`${what} returned no image`);
}

export function openaiClient({ baseUrl = config.IMAGE_API_URL, apiKey = config.IMAGE_API_KEY, model = config.IMAGE_MODEL, timeoutMs = config.IMAGE_TIMEOUT_SECONDS * 1000 } = {}) {
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const size = ({ width, height }) => `${width}x${height}`;
  return {
    name: 'openai',
    async generate(prompt, { width = config.PLATE_WIDTH, height = config.PLATE_HEIGHT } = {}) {
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model, prompt, n: 1, size: size({ width, height }), response_format: 'b64_json' }),
      });
      return readImageResponse(res, 'images/generations');
    },
    async edit(image, prompt, { width = config.PLATE_WIDTH, height = config.PLATE_HEIGHT } = {}) {
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt);
      form.set('n', '1');
      form.set('size', size({ width, height }));
      form.set('response_format', 'b64_json');
      form.set('image', new Blob([image], { type: sniff(image) }), 'reference.png');
      const res = await fetch(`${baseUrl}/images/edits`, { method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(timeoutMs) });
      return readImageResponse(res, 'images/edits');
    },
  };
}

/** The ComfyUI graph (API format) for FLUX.2: with `reference` (an uploaded file name) it edits, otherwise it generates. */
export function comfyWorkflow({ prompt, width, height, seed, reference = null, unet = config.COMFY_UNET, clip = config.COMFY_CLIP, vae = config.COMFY_VAE, steps = config.IMAGE_STEPS, guidance = config.IMAGE_GUIDANCE }) {
  const g = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'flux2', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    6: { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: 1 } },
    7: { class_type: 'Flux2Scheduler', inputs: { steps, width, height } },
    8: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    9: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    12: { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    13: { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'birds' } },
  };
  let cond = ['4', 0];
  if (reference) {
    g[20] = { class_type: 'LoadImage', inputs: { image: reference } };
    g[21] = { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['20', 0], upscale_method: 'lanczos', megapixels: (width * height) / 1e6, resolution_steps: 1 } };
    g[22] = { class_type: 'VAEEncode', inputs: { pixels: ['21', 0], vae: ['3', 0] } };
    g[23] = { class_type: 'ReferenceLatent', inputs: { conditioning: cond, latent: ['22', 0] } };
    cond = ['23', 0];
  }
  g[5] = { class_type: 'FluxGuidance', inputs: { conditioning: cond, guidance } };
  g[10] = { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['5', 0] } };
  g[11] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['8', 0], sigmas: ['7', 0], latent_image: ['6', 0] } };
  return g;
}

export function comfyClient({ baseUrl = config.COMFY_URL, timeoutMs = config.IMAGE_TIMEOUT_SECONDS * 1000, pollMs = 1500, ...overrides } = {}) {
  const clientId = `samsung-epaper-birds-${Math.random().toString(36).slice(2)}`;
  const json = async (res, what) => {
    if (!res.ok) throw new Error(`ComfyUI ${what} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
  async function upload(image) {
    const form = new FormData();
    const name = `birds-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
    form.set('image', new Blob([image], { type: sniff(image) }), name);
    form.set('overwrite', 'true');
    const out = await json(await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) }), 'upload/image');
    return out.name;
  }
  async function run(workflow) {
    const queued = await json(await fetch(`${baseUrl}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }), signal: AbortSignal.timeout(30000),
    }), 'prompt');
    const id = queued.prompt_id;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const hist = await json(await fetch(`${baseUrl}/history/${id}`, { signal: AbortSignal.timeout(30000) }), 'history');
      const entry = hist[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') {
        const msg = entry.status.messages?.find((m) => m[0] === 'execution_error')?.[1]?.exception_message;
        throw new Error(`ComfyUI failed: ${msg || 'execution error'}`);
      }
      const img = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
        const res = await fetch(`${baseUrl}/view?${q}`, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`ComfyUI view answered ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      }
    }
    throw new Error(`ComfyUI did not finish within ${Math.round(timeoutMs / 1000)}s`);
  }
  const seedOf = (o) => o.seed ?? Math.floor(Math.random() * 2 ** 31);
  return {
    name: 'comfyui',
    generate: (prompt, { width = config.PLATE_WIDTH, height = config.PLATE_HEIGHT, seed } = {}) =>
      run(comfyWorkflow({ prompt, width, height, seed: seedOf({ seed }), ...overrides })),
    async edit(image, prompt, { width = config.PLATE_WIDTH, height = config.PLATE_HEIGHT, seed } = {}) {
      const reference = await upload(image);
      return run(comfyWorkflow({ prompt, width, height, seed: seedOf({ seed }), reference, ...overrides }));
    },
  };
}

export function createImageClient(backend = config.IMAGE_BACKEND) {
  if (backend === 'openai') return openaiClient();
  if (backend === 'comfyui') return comfyClient();
  return null;
}
