/**
 * Flux Studio v2 — Catalogue de workflows prêts à l'emploi
 *
 * Chaque entrée décrit UN modèle réellement installé sur la machine et le
 * graphe minimal pour l'utiliser. Le bouton « Appliquer » construit tout
 * automatiquement (aucun nœud à câbler à la main).
 *
 * Les chemins sont ceux de F:\f\ComfyUI\models\ — vérifiés le 15/10/2026.
 */

export const WorkflowCatalog = [

  /* ==================== SDXL (validé) ==================== */
  {
    id: 'sdxl-base',
    name: 'SDXL — Base',
    model: 'SDXL',
    checkpoint: 'sd_xl_base_1.0.safetensors',
    icon: '★',
    tested: true,
    size: '1024×1024',
    steps: 24,
    cfg: 7,
    desc: 'Le point de départ fiable. Checkpoint complet (modèle + CLIP + VAE).',
    loras: [],
    graph: {
      loader: { type: 'CheckpointLoaderSimple', ckpt: 'sd_xl_base_1.0.safetensors' },
      clip: 'CheckpointLoaderSimple',
      latent: { type: 'EmptyLatentImage', width: 1024, height: 1024 },
      sampler: { type: 'KSampler', steps: 24, cfg: 7, sampler: 'euler', scheduler: 'normal' },
      prompt: 'a beautiful woman, detailed portrait, professional photography, soft light, 8k',
      negative: 'blurry, bad anatomy, watermark, low quality',
    },
  },
  {
    id: 'sdxl-refiner',
    name: 'SDXL — Refine 1.0',
    model: 'SDXL',
    checkpoint: 'sd_xl_refiner_1.0.safetensors',
    icon: '★',
    tested: false,
    size: '1024×1024',
    steps: 20,
    cfg: 7,
    desc: 'Refineur de passe 2 : nettoie les défauts après un premier jet SDXL.',
    loras: [],
    graph: {
      loader: { type: 'CheckpointLoaderSimple', ckpt: 'sd_xl_refiner_1.0.safetensors' },
      clip: 'CheckpointLoaderSimple',
      latent: { type: 'EmptyLatentImage', width: 1024, height: 1024 },
      sampler: { type: 'KSampler', steps: 20, cfg: 7, sampler: 'euler', scheduler: 'normal' },
      prompt: 'a beautiful woman, detailed portrait, sharp focus, clean skin',
      negative: 'blurry, noise, artifacts, low quality',
    },
  },
  {
    id: 'sdxl-turbo',
    name: 'SDXL — Turbo (1-4 étapes)',
    model: 'SDXL',
    checkpoint: 'sd_xl_turbo_1.0_fp16.safetensors',
    icon: '⚡',
    tested: false,
    size: '512×512',
    steps: 4,
    cfg: 1,
    desc: 'Turbo : ultra rapide (4 étapes), idéal pour tester des prompts et des LoRA.',
    loras: [],
    graph: {
      loader: { type: 'CheckpointLoaderSimple', ckpt: 'sd_xl_turbo_1.0_fp16.safetensors' },
      clip: 'CheckpointLoaderSimple',
      latent: { type: 'EmptyLatentImage', width: 512, height: 512 },
      sampler: { type: 'KSampler', steps: 4, cfg: 1, sampler: 'euler_ancestral', scheduler: 'sgm_uniform' },
      prompt: 'a beautiful woman, detailed, sharp',
      negative: 'blurry, low quality',
    },
  },
  {
    id: 'sdxl-lora-mj52',
    name: 'SDXL + LoRA Sinfully Stylish',
    model: 'SDXL',
    checkpoint: 'sd_xl_base_1.0.safetensors',
    icon: '★',
    tested: false,
    size: '1024×1024',
    steps: 24,
    cfg: 7,
    desc: 'SDXL + LoRA stylisée « Sinfully_Stylish_1.0_SDXL » (présente dans tes modèles).',
    loras: [{ path: 'SDXL 1.0/sdxl/Sinfully_Stylish_1.0_SDXL.safetensors', strength: 0.8 }],
    graph: {
      loader: { type: 'CheckpointLoaderSimple', ckpt: 'sd_xl_base_1.0.safetensors' },
      clip: 'CheckpointLoaderSimple',
      latent: { type: 'EmptyLatentImage', width: 1024, height: 1024 },
      sampler: { type: 'KSampler', steps: 24, cfg: 7, sampler: 'euler', scheduler: 'normal' },
      prompt: 'a beautiful woman, stylish outfit, elegant, editorial fashion',
      negative: 'blurry, bad anatomy, low quality',
      loraNode: { type: 'LoraLoader', strength_model: 0.8, strength_clip: 0.8 },
    },
  },

  /* ==================== FLUX.1 (validé) ==================== */
  {
    id: 'flux1-dev',
    name: 'FLUX.1 Dev',
    model: 'FLUX.1',
    icon: '◉',
    tested: true,
    size: '768×1024',
    steps: 24,
    cfg: 1,
    desc: 'FLUX.1 Dev fp8 via UNETLoader + SamplerCustom. Testé et validé sur ta machine.',
    loras: [],
    graph: {
      unet: { type: 'UNETLoader', name: 'flux1-dev-fp8.safetensors', dtype: 'default' },
      clip: { type: 'DualCLIPLoader', clip1: 't5xxl_fp8_e4m3fn.safetensors', clip2: 'clip_l.safetensors', kind: 'flux' },
      latent: { type: 'EmptyFlux2LatentImage', width: 768, height: 1024 },
      sampler: { type: 'SamplerCustom', add_noise: true, seed: 42, cfg: 1 },
      samplerSelect: { type: 'KSamplerSelect', name: 'euler' },
      scheduler: { type: 'BasicScheduler', kind: 'simple', steps: 24, denoise: 1 },
      vae: { type: 'VAELoader', name: 'ae.safetensors' },
      prompt: 'a beautiful woman, detailed portrait, soft rim light, 85mm lens, 8k',
      negative: 'blurry, deformed, watermark',
    },
  },
  {
    id: 'flux2-klein',
    name: 'FLUX.2 Klein 4B',
    model: 'FLUX.2',
    icon: '◆',
    tested: true,
    slow: true,
    eta: '≈ 4 min',
    size: '1024×1024',
    steps: 4,
    cfg: 1,
    desc: 'FLUX.2 Klein 4B distillé (4 étapes) — encodeur Qwen 3 4B, Flux2Scheduler, CFGGuider. ' +
      'Validé en exécution réelle. Lent sur RTX 3060 (l’encodeur de texte domine le temps).',
    loras: [],
    graph: {
      kind: 'flux2',
      unet: { type: 'UNETLoader', name: 'flux-2-klein-4b.safetensors', dtype: 'default' },
      clip: { type: 'CLIPLoader', name: 'qwen_3_4b.safetensors', kind: 'flux2' },
      vae: { type: 'VAELoader', name: 'flux2-vae.safetensors' },
      latent: { type: 'EmptyFlux2LatentImage', width: 1024, height: 1024 },
      prompt: 'a beautiful woman, professional portrait, soft studio lighting, detailed skin, 85mm lens',
      negative: 'blurry, deformed, extra fingers, watermark, text, low quality',
    },
  },
  {
    id: 'flux-realistic',
    name: 'FLUX + Realistic Skin',
    model: 'FLUX.1',
    icon: '◉',
    tested: false,
    size: '768×1024',
    steps: 24,
    cfg: 1,
    desc: 'FLUX.1 Dev + « aidmaRealisticSkin-FLUX-v0.1 » : rendu peau réaliste (tu as cette LoRA).',
    loras: [{ path: 'Flux.1 D/aidmaRealisticSkin-FLUX-v0.1.safetensors', strength: 0.75 }],
    graph: {
      unet: { type: 'UNETLoader', name: 'flux1-dev-fp8.safetensors', dtype: 'default' },
      clip: { type: 'DualCLIPLoader', clip1: 't5xxl_fp8_e4m3fn.safetensors', clip2: 'clip_l.safetensors', kind: 'flux' },
      latent: { type: 'EmptyFlux2LatentImage', width: 768, height: 1024 },
      sampler: { type: 'SamplerCustom', add_noise: true, seed: 42, cfg: 1 },
      samplerSelect: { type: 'KSamplerSelect', name: 'euler' },
      scheduler: { type: 'BasicScheduler', kind: 'simple', steps: 24, denoise: 1 },
      vae: { type: 'VAELoader', name: 'ae.safetensors' },
      loraNode: { type: 'LoraLoader', strength_model: 0.75, strength_clip: 0.75 },
      prompt: 'a beautiful woman, realistic skin texture, natural pores, studio softbox lighting, 85mm',
      negative: 'plastic skin, over-smoothed, blurry, airbrushed',
    },
  },

  /* ==================== SD 1.5 (validé) ==================== */
  {
    id: 'sd15-base',
    name: 'SD 1.5 — Base',
    model: 'SD 1.5',
    checkpoint: 'v1-5-pruned-emaonly-fp16.safetensors',
    icon: '◇',
    tested: true,
    size: '512×768',
    steps: 25,
    cfg: 7,
    desc: 'SD 1.5 classique. Rapide, très compatible avec les 16 LoRA SD 1.5 installées.',
    loras: [],
    graph: {
      loader: { type: 'CheckpointLoaderSimple', ckpt: 'v1-5-pruned-emaonly-fp16.safetensors' },
      clip: 'CheckpointLoaderSimple',
      latent: { type: 'EmptyLatentImage', width: 512, height: 768 },
      sampler: { type: 'KSampler', steps: 25, cfg: 7, sampler: 'euler', scheduler: 'normal' },
      prompt: 'a beautiful woman, masterpiece, best quality, detailed',
      negative: 'worst quality, low quality, bad anatomy, watermark',
    },
  },

  /* ==================== LoRA à personality (FLUX) ==================== */
  {
    id: 'flux-persona',
    name: 'FLUX + Persona (Brandi Love)',
    model: 'FLUX.1',
    icon: '👤',
    tested: false,
    size: '768×1024',
    steps: 24,
    cfg: 1,
    desc: 'FLUX.1 + LoRA « PERSONNE__Brandi_Love_Flux ». Idéal portraits réalistes.',
    loras: [{ path: '_PERSONNES_REELLES_/Unknown/no tags/PERSONNE__Brandi_Love_Flux.safetensors', strength: 0.85 }],
    graph: {
      unet: { type: 'UNETLoader', name: 'flux1-dev-fp8.safetensors', dtype: 'default' },
      clip: { type: 'DualCLIPLoader', clip1: 't5xxl_fp8_e4m3fn.safetensors', clip2: 'clip_l.safetensors', kind: 'flux' },
      latent: { type: 'EmptyFlux2LatentImage', width: 768, height: 1024 },
      sampler: { type: 'SamplerCustom', add_noise: true, seed: 42, cfg: 1 },
      samplerSelect: { type: 'KSamplerSelect', name: 'euler' },
      scheduler: { type: 'BasicScheduler', kind: 'simple', steps: 24, denoise: 1 },
      vae: { type: 'VAELoader', name: 'ae.safetensors' },
      loraNode: { type: 'LoraLoader', strength_model: 0.85, strength_clip: 0.85 },
      prompt: 'brandi love, professional photoshoot, soft light, detailed skin, 85mm',
      negative: 'blurry, deformed, extra fingers',
    },
  },
  {
    id: 'flux-cyberpunk',
    name: 'FLUX + Neon Cyberpunk',
    model: 'FLUX.1',
    icon: '🌃',
    tested: false,
    size: '1024×768',
    steps: 24,
    cfg: 1,
    desc: 'FLUX.1 + LoRA « Neon_Cyberpunk_Cyberspace_FLUX ». Style science-fiction coloré.',
    loras: [{ path: 'Flux.1 D/Neon_Cyberpunk_Cyberspace_FLUX.safetensors', strength: 0.8 }],
    graph: {
      unet: { type: 'UNETLoader', name: 'flux1-dev-fp8.safetensors', dtype: 'default' },
      clip: { type: 'DualCLIPLoader', clip1: 't5xxl_fp8_e4m3fn.safetensors', clip2: 'clip_l.safetensors', kind: 'flux' },
      latent: { type: 'EmptyFlux2LatentImage', width: 1024, height: 768 },
      sampler: { type: 'SamplerCustom', add_noise: true, seed: 42, cfg: 1 },
      samplerSelect: { type: 'KSamplerSelect', name: 'euler' },
      scheduler: { type: 'BasicScheduler', kind: 'simple', steps: 24, denoise: 1 },
      vae: { type: 'VAELoader', name: 'ae.safetensors' },
      loraNode: { type: 'LoraLoader', strength_model: 0.8, strength_clip: 0.8 },
      prompt: 'cyberpunk woman, neon lights, rain, reflections, blade runner aesthetic, cinematic',
      negative: 'blurry, daylight, flat lighting',
    },
  },

  /* ==================== LoRA qualité/corps ==================== */
  {
    id: 'flux-skin-detail',
    name: 'FLUX + Skin Detail Slider',
    model: 'FLUX.1',
    icon: '✦',
    tested: false,
    size: '768×1024',
    steps: 24,
    cfg: 1,
    desc: 'FLUX + « skin_detail_slider_krea2_ZT-V1 » : contrôle la précision de la peau.',
    loras: [{ path: 'skin_detail_slider_krea2_ZT-V1.safetensors', strength: 0.7 }],
    graph: {
      unet: { type: 'UNETLoader', name: 'flux1-dev-fp8.safetensors', dtype: 'default' },
      clip: { type: 'DualCLIPLoader', clip1: 't5xxl_fp8_e4m3fn.safetensors', clip2: 'clip_l.safetensors', kind: 'flux' },
      latent: { type: 'EmptyFlux2LatentImage', width: 768, height: 1024 },
      sampler: { type: 'SamplerCustom', add_noise: true, seed: 42, cfg: 1 },
      samplerSelect: { type: 'KSamplerSelect', name: 'euler' },
      scheduler: { type: 'BasicScheduler', kind: 'simple', steps: 24, denoise: 1 },
      vae: { type: 'VAELoader', name: 'ae.safetensors' },
      loraNode: { type: 'LoraLoader', strength_model: 0.7, strength_clip: 0.7 },
      prompt: 'a beautiful woman, hyper detailed skin texture, pores visible, studio lighting',
      negative: 'smooth plastic skin, blurry, airbrushed',
    },
  },

  /* ==================== Upscale ==================== */
  {
    id: 'upscale-real',
    name: 'Upscale 4× UltraSharp',
    model: 'Tous',
    icon: '⬆',
    tested: false,
    size: 'auto',
    desc: 'Agrandit n’importe quelle image 4× avec UltraSharp. Compatible avec les 12 upscalers installés.',
    isUtility: true,
    upscaler: '4x-UltraSharp.pth',
  },
  {
    id: 'upscale-anime',
    name: 'Upscale 4× Anime',
    model: 'Tous',
    icon: '⬆',
    tested: false,
    size: 'auto',
    desc: 'AnimeSharp : upscale spécialisé illustrations / anime.',
    isUtility: true,
    upscaler: '4x-AnimeSharp.pth',
  },
  {
    id: 'upscale-faces',
    name: 'Upscale 8× Visages',
    model: 'Tous',
    icon: '⬆',
    tested: false,
    size: 'auto',
    desc: 'NMKD-Faces 8× : idéal pour gros plans de visages.',
    isUtility: true,
    upscaler: '8x_NMKD-Faces_160000_G.pth',
  },
];

export function findWorkflow(id) {
  return WorkflowCatalog.find(w => w.id === id);
}

export function workflowsByModel() {
  const g = {};
  WorkflowCatalog.forEach(w => {
    if (!g[w.model]) g[w.model] = [];
    g[w.model].push(w);
  });
  return g;
}

/**
 * Normalise un chemin de modèle pour comparaison.
 * ComfyUI sous Windows utilise "\", le web "/" : on compare les deux pareils.
 */
const _normPath = (s) => String(s || '').replace(/\\/g, '/').toLowerCase().trim();

/**
 * Retrouve le nom EXACT qu'attend ComfyUI pour un fichier.
 *
 * Indispensable : /prompt valide chaque nom contre la liste interne de
 * ComfyUI et rejette au moindre écart ("Value not in list"). Écrire
 * "Flux.1 D/x.safetensors" au lieu de "Flux.1 D\\x.safetensors" échoue.
 * On matche sans se soucier du séparateur ni de la casse, puis on renvoie
 * la chaîne officielle.
 */
export function resolveModelName(category, wanted, models) {
  if (!wanted) return wanted;
  const list = models[category] || [];
  const w = _normPath(wanted);
  if (list.some(n => _normPath(n) === w)) {
    return list.find(n => _normPath(n) === w);
  }
  // Repli : correspondance par nom de fichier seul (sous-dossier different)
  const base = w.split('/').pop();
  const hit = list.find(n => _normPath(n).split('/').pop() === base);
  return hit || wanted;
}

/** Vérifie qu'un workflow pointe vers des fichiers réellement installés. */
export function checkAvailable(entry, models) {
  const missing = [];
  // Présent = trouvé dans la liste (comparaison insensible au séparateur/à la casse)
  const has = (cat, name) => {
    if (!name) return true;
    const list = models[cat] || [];
    const n = _normPath(name);
    return list.some(x => _normPath(x) === n)
        || list.some(x => _normPath(x).split('/').pop() === n.split('/').pop());
  };

  if (entry.graph?.loader && !has('checkpoints', entry.graph.loader.ckpt))
    missing.push(`checkpoints/${entry.graph.loader.ckpt}`);
  if (entry.graph?.unet) {
    if (!has('diffusion_models', entry.graph.unet.name) && !has('unet', entry.graph.unet.name))
      missing.push(`diffusion_models/${entry.graph.unet.name}`);
  }
  if (entry.graph?.vae && !has('vae', entry.graph.vae.name))
    missing.push(`vae/${entry.graph.vae.name}`);
  if (entry.graph?.clip?.clip1) {
    if (!has('clip', entry.graph.clip.clip1)) missing.push(`clip/${entry.graph.clip.clip1}`);
    if (!has('clip', entry.graph.clip.clip2)) missing.push(`clip/${entry.graph.clip.clip2}`);
  }
  // Pipeline FLUX.2 : encodeur unique (Qwen) au lieu de T5XXL + CLIP-L
  if (entry.graph?.clip?.name && !has('clip', entry.graph.clip.name))
    missing.push(`clip/${entry.graph.clip.name}`);
  (entry.loras || []).forEach(l => { if (!has('loras', l.path)) missing.push(`loras/${l.path}`); });
  if (entry.upscaler && !has('upscale_models', entry.upscaler))
    missing.push(`upscale_models/${entry.upscaler}`);

  return { ok: missing.length === 0, missing };
}
