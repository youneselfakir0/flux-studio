/**
 * Flux Studio v2 — Workflow Templates
 *
 * IMPORTANT — configurations VALIDÉES sur cette machine (testées contre ComfyUI 0.39.2) :
 *   • SDXL/SD 1.5  : CheckpointLoaderSimple + KSampler  ✅ génère en ~25 s
 *   • FLUX.1      : UNETLoader(flux1-dev-fp8) + SamplerCustom  ✅ génère en ~25 s
 *   • FLUX.2      : UNETLoader(flux-2-klein-4b) + CLIPTextEncodeFlux  ❌ non fonctionnel (mismatch tokens)
 *   • Checkpoint "FLUX Dev (Quantized)" : NE PAS UTILISER — NF4 bitsandbytes, non chargeable
 */

import { graph } from '../editor/graph.js';

function clearAll() {
  graph.clear();
}

export const Templates = {

  /* ------------------------------------------------------------------ */
  'sdxl-txt2img': {
    name: 'SDXL txt2img',
    category: 'SDXL',
    model: 'SDXL',
    description: 'Text-to-image SDXL — validé ✓',
    build() {
      clearAll();
      const ckpt = graph.addNode('CheckpointLoaderSimple', { x: 80, y: 220 });
      ckpt.setWidget('ckpt_name', 'sd_xl_base_1.0.safetensors');

      const pos = graph.addNode('CLIPTextEncode', { x: 400, y: 100 });
      pos.setWidget('text', 'a beautiful woman, detailed portrait, professional photography, soft light, 8k');

      const neg = graph.addNode('CLIPTextEncode', { x: 400, y: 300 });
      neg.setWidget('text', 'blurry, bad anatomy, watermark, low quality');

      const latent = graph.addNode('EmptyLatentImage', { x: 400, y: 500 });
      latent.setWidget('width', 1024); latent.setWidget('height', 1024); latent.setWidget('batch_size', 1);

      const ks = graph.addNode('KSampler', { x: 720, y: 240 });
      ks.setWidget('steps', 24); ks.setWidget('cfg', 7);
      ks.setWidget('sampler_name', 'euler'); ks.setWidget('scheduler', 'normal');
      ks.setWidget('seed', 42); ks.setWidget('denoise', 1);

      const decode = graph.addNode('VAEDecode', { x: 1020, y: 240 });
      const save = graph.addNode('SaveImage', { x: 1300, y: 240 });
      save.setWidget('filename_prefix', 'flux_studio');

      graph.connect(ckpt.id, 'CLIP', pos.id, 'clip');
      graph.connect(ckpt.id, 'CLIP', neg.id, 'clip');
      graph.connect(ckpt.id, 'MODEL', ks.id, 'model');
      graph.connect(pos.id, 'CONDITIONING', ks.id, 'positive');
      graph.connect(neg.id, 'CONDITIONING', ks.id, 'negative');
      graph.connect(latent.id, 'LATENT', ks.id, 'latent_image');
      graph.connect(ks.id, 'LATENT', decode.id, 'samples');
      graph.connect(ckpt.id, 'VAE', decode.id, 'vae');
      graph.connect(decode.id, 'IMAGE', save.id, 'images');
      return { nodes: 8, edges: 8 };
    },
  },

  /* ------------------------------------------------------------------ */
  'flux-txt2img': {
    name: 'FLUX.1 txt2img',
    category: 'FLUX',
    model: 'FLUX.1',
    description: 'Text-to-image FLUX.1 fp8 — validé ✓ (UNETLoader + SamplerCustom)',
    build() {
      clearAll();
      // ⚠ UNETLoader, pas CheckpointLoaderSimple : le checkpoint NF4 est inutilisable
      const unet = graph.addNode('UNETLoader', { x: 60, y: 220 });
      unet.setWidget('unet_name', 'flux1-dev-fp8.safetensors');
      unet.setWidget('weight_dtype', 'default');

      const clip = graph.addNode('DualCLIPLoader', { x: 60, y: 420 });
      clip.setWidget('clip_name1', 't5xxl_fp8_e4m3fn.safetensors');
      clip.setWidget('clip_name2', 'clip_l.safetensors');
      clip.setWidget('type', 'flux');

      const pos = graph.addNode('CLIPTextEncode', { x: 400, y: 100 });
      pos.setWidget('text', 'a beautiful woman, detailed portrait, soft rim light, 85mm, 8k');

      const neg = graph.addNode('CLIPTextEncode', { x: 400, y: 300 });
      neg.setWidget('text', 'blurry, deformed, watermark');

      const latent = graph.addNode('EmptyFlux2LatentImage', { x: 400, y: 500 });
      latent.setWidget('width', 768); latent.setWidget('height', 1024); latent.setWidget('batch_size', 1);

      const pick = graph.addNode('KSamplerSelect', { x: 700, y: 620 });
      pick.setWidget('sampler_name', 'euler');

      const sched = graph.addNode('BasicScheduler', { x: 700, y: 720 });
      sched.setWidget('scheduler', 'simple'); sched.setWidget('steps', 4); sched.setWidget('denoise', 1);

      const ks = graph.addNode('SamplerCustom', { x: 700, y: 260 });
      ks.setWidget('add_noise', true); ks.setWidget('noise_seed', 42); ks.setWidget('cfg', 1);

      const vae = graph.addNode('VAELoader', { x: 1000, y: 620 });
      vae.setWidget('vae_name', 'ae.safetensors');

      const decode = graph.addNode('VAEDecode', { x: 1300, y: 260 });
      const save = graph.addNode('SaveImage', { x: 1580, y: 260 });
      save.setWidget('filename_prefix', 'flux_studio');

      graph.connect(unet.id, 'MODEL', sched.id, 'model');
      graph.connect(clip.id, 'CLIP', pos.id, 'clip');
      graph.connect(clip.id, 'CLIP', neg.id, 'clip');
      graph.connect(unet.id, 'MODEL', ks.id, 'model');
      graph.connect(pos.id, 'CONDITIONING', ks.id, 'positive');
      graph.connect(neg.id, 'CONDITIONING', ks.id, 'negative');
      graph.connect(pick.id, 'SAMPLER', ks.id, 'sampler');
      graph.connect(sched.id, 'SIGMAS', ks.id, 'sigmas');
      graph.connect(latent.id, 'LATENT', ks.id, 'latent_image');
      graph.connect(ks.id, 'LATENT', decode.id, 'samples');
      graph.connect(vae.id, 'VAE', decode.id, 'vae');
      graph.connect(decode.id, 'IMAGE', save.id, 'images');
      return { nodes: 11, edges: 11 };
    },
  },

  /* ------------------------------------------------------------------ */
  'sd15-txt2img': {
    name: 'SD 1.5 txt2img',
    category: 'SD 1.5',
    model: 'SD 1.5',
    description: 'Text-to-image SD 1.5 — validé ✓',
    build() {
      clearAll();
      const ckpt = graph.addNode('CheckpointLoaderSimple', { x: 80, y: 220 });
      ckpt.setWidget('ckpt_name', 'v1-5-pruned-emaonly-fp16.safetensors');

      const pos = graph.addNode('CLIPTextEncode', { x: 400, y: 100 });
      pos.setWidget('text', 'a beautiful woman, masterpiece, best quality, detailed');
      const neg = graph.addNode('CLIPTextEncode', { x: 400, y: 300 });
      neg.setWidget('text', 'worst quality, low quality, bad anatomy, watermark');

      const latent = graph.addNode('EmptyLatentImage', { x: 400, y: 500 });
      latent.setWidget('width', 512); latent.setWidget('height', 768); latent.setWidget('batch_size', 1);

      const ks = graph.addNode('KSampler', { x: 720, y: 240 });
      ks.setWidget('steps', 25); ks.setWidget('cfg', 7);
      ks.setWidget('sampler_name', 'euler'); ks.setWidget('scheduler', 'normal');
      ks.setWidget('seed', 42); ks.setWidget('denoise', 1);

      const decode = graph.addNode('VAEDecode', { x: 1020, y: 240 });
      const save = graph.addNode('SaveImage', { x: 1300, y: 240 });

      graph.connect(ckpt.id, 'CLIP', pos.id, 'clip');
      graph.connect(ckpt.id, 'CLIP', neg.id, 'clip');
      graph.connect(ckpt.id, 'MODEL', ks.id, 'model');
      graph.connect(pos.id, 'CONDITIONING', ks.id, 'positive');
      graph.connect(neg.id, 'CONDITIONING', ks.id, 'negative');
      graph.connect(latent.id, 'LATENT', ks.id, 'latent_image');
      graph.connect(ks.id, 'LATENT', decode.id, 'samples');
      graph.connect(ckpt.id, 'VAE', decode.id, 'vae');
      graph.connect(decode.id, 'IMAGE', save.id, 'images');
      return { nodes: 8, edges: 8 };
    },
  },

  /* ------------------------------------------------------------------ */
  'sdxl-img2img': {
    name: 'SDXL img2img',
    category: 'SDXL',
    model: 'SDXL',
    description: 'Image-to-image SDXL (dénoise = force du changement)',
    build() {
      Templates['sdxl-txt2img'].build();
      // Remplace le latent par un encodage d'image chargée
      const latent = [...graph.nodes.values()].find(n => n.type === 'EmptyLatentImage');
      if (!latent) return;
      const load = graph.addNode('LoadImage', { x: 400, y: 620 });
      const encode = graph.addNode('VAEEncode', { x: 620, y: 560 });
      const ckpt = [...graph.nodes.values()].find(n => n.type === 'CheckpointLoaderSimple');
      const ks = [...graph.nodes.values()].find(n => n.type === 'KSampler');
      if (!ckpt || !ks) return;

      ks.setWidget('denoise', 0.6);
      graph.removeNode(latent.id);
      graph.connect(load.id, 'IMAGE', encode.id, 'pixels');
      graph.connect(ckpt.id, 'VAE', encode.id, 'vae');
      graph.connect(encode.id, 'LATENT', ks.id, 'latent_image');
    },
  },

  /* ------------------------------------------------------------------ */
  'flux2-experimental': {
    name: 'FLUX.2 (expérimental)',
    category: 'FLUX',
    model: 'FLUX.2',
    description: 'FLUX.2 Klein — ⚠ non fonctionnel sur cette machine (mismatch tokens)',
    experimental: true,
    build() {
      clearAll();
      const unet = graph.addNode('UNETLoader', { x: 60, y: 220 });
      unet.setWidget('unet_name', 'flux-2-klein-4b.safetensors');
      unet.setWidget('weight_dtype', 'fp8_e4m3fn');

      const clip = graph.addNode('DualCLIPLoader', { x: 60, y: 420 });
      clip.setWidget('clip_name1', 't5xxl_fp8_e4m3fn.safetensors');
      clip.setWidget('clip_name2', 'clip_l.safetensors');
      clip.setWidget('type', 'flux');

      // CLIPTextEncodeFlux attend clip_l ET t5xxl en texte, pas "text"
      const pos = graph.addNode('CLIPTextEncodeFlux', { x: 400, y: 100 });
      pos.setWidget('clip_l', 'a beautiful woman, detailed portrait');
      pos.setWidget('t5xxl', 'a beautiful woman, detailed portrait');
      pos.setWidget('guidance', 3.5);

      const neg = graph.addNode('CLIPTextEncodeFlux', { x: 400, y: 320 });
      neg.setWidget('clip_l', ''); neg.setWidget('t5xxl', ''); neg.setWidget('guidance', 3.5);

      const latent = graph.addNode('EmptyFlux2LatentImage', { x: 400, y: 520 });
      latent.setWidget('width', 768); latent.setWidget('height', 1024);

      const pick = graph.addNode('KSamplerSelect', { x: 700, y: 640 });
      pick.setWidget('sampler_name', 'euler');
      const sched = graph.addNode('BasicScheduler', { x: 700, y: 740 });
      sched.setWidget('scheduler', 'simple'); sched.setWidget('steps', 4); sched.setWidget('denoise', 1);

      const ks = graph.addNode('SamplerCustom', { x: 700, y: 280 });
      ks.setWidget('add_noise', true); ks.setWidget('noise_seed', 42); ks.setWidget('cfg', 1);

      const vae = graph.addNode('VAELoader', { x: 1000, y: 640 });
      vae.setWidget('vae_name', 'flux2-vae.safetensors');
      const decode = graph.addNode('VAEDecode', { x: 1300, y: 280 });
      const save = graph.addNode('SaveImage', { x: 1580, y: 280 });

      graph.connect(unet.id, 'MODEL', sched.id, 'model');
      graph.connect(clip.id, 'CLIP', pos.id, 'clip');
      graph.connect(clip.id, 'CLIP', neg.id, 'clip');
      graph.connect(unet.id, 'MODEL', ks.id, 'model');
      graph.connect(pos.id, 'CONDITIONING', ks.id, 'positive');
      graph.connect(neg.id, 'CONDITIONING', ks.id, 'negative');
      graph.connect(pick.id, 'SAMPLER', ks.id, 'sampler');
      graph.connect(sched.id, 'SIGMAS', ks.id, 'sigmas');
      graph.connect(latent.id, 'LATENT', ks.id, 'latent_image');
      graph.connect(ks.id, 'LATENT', decode.id, 'samples');
      graph.connect(vae.id, 'VAE', decode.id, 'vae');
      graph.connect(decode.id, 'IMAGE', save.id, 'images');
    },
  },
};

export function getTemplate(name) {
  return Templates[name];
}

export function getAllTemplates() {
  return Object.entries(Templates).map(([id, t]) => ({ id, ...t }));
}

export function listByCategory() {
  const result = {};
  getAllTemplates().forEach(t => {
    if (!result[t.category]) result[t.category] = [];
    result[t.category].push(t);
  });
  return result;
}

