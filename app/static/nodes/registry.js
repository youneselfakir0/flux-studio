/**
 * Flux Studio v2 — Node Registry
 * Complete ComfyUI node definitions for Flux, SDXL, SD 1.5, and utilities
 * Each node: { type, category, title, inputs[], outputs[], widgets[], defaults, description }
 */

export const NodeCategories = {
  loaders: 'Loaders',
  conditioners: 'Conditioning',
  sampling: 'Sampling',
  latent: 'Latent',
  vae: 'VAE',
  image: 'Image',
  utils: 'Utils',
  controlnet: 'ControlNet',
  flux: 'Flux Specific',
  sdxl: 'SDXL Specific',
  upscale: 'Upscale',
  masks: 'Masks',
};

export const NodeRegistry = [
  // ===================== LOADERS =====================
  {
    type: 'CheckpointLoaderSimple',
    category: NodeCategories.loaders,
    title: 'Load Checkpoint',
    inputs: [],
    outputs: ['MODEL', 'CLIP', 'VAE'],
    widgets: [
      { name: 'ckpt_name', type: 'dynamic', source: 'checkpoints', label: 'Checkpoint', required: true,
        default: 'sd_xl_base_1.0.safetensors' },
    ],
    defaults: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
    description: 'Charge un checkpoint complet (modèle + CLIP + VAE). Utilisez pour SDXL / SD 1.5. ' +
      '⚠ Ne pas utiliser pour FLUX Dev (Quantized) : c’est du NF4 bitsandbytes, non chargeable ainsi.',
  },
  {
    type: 'UNETLoader',
    category: NodeCategories.loaders,
    title: 'Load Diffusion Model (UNET)',
    inputs: [],
    outputs: ['MODEL'],
    widgets: [
      { name: 'unet_name', type: 'dynamic', source: 'diffusion_models', label: 'Diffusion Model', required: true,
        default: 'flux1-dev-fp8.safetensors' },
      { name: 'weight_dtype', type: 'combo', options: ['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2'],
        default: 'default', label: 'Dtype' },
    ],
    defaults: { unet_name: 'flux1-dev-fp8.safetensors', weight_dtype: 'default' },
    description: 'Charge un modèle de diffusion seul (format « diffusion_models »). ' +
      'C’est la méthode correcte pour FLUX Dev fp8 et FLUX.2 Klein.',
  },
  {
    type: 'DualCLIPLoader',
    category: NodeCategories.loaders,
    title: 'Dual CLIP Loader (Flux/SDXL)',
    inputs: [],
    outputs: ['CLIP'],
    widgets: [
      { name: 'clip_name1', type: 'dynamic', source: 'clip', label: 'CLIP 1', required: true,
        default: 't5xxl_fp8_e4m3fn.safetensors' },
      { name: 'clip_name2', type: 'dynamic', source: 'clip', label: 'CLIP 2', required: true,
        default: 'clip_l.safetensors' },
      { name: 'type', type: 'combo', options: ['flux', 'sdxl', 'sd3', 'ltxv', 'hidream'], default: 'flux', label: 'Type' },
    ],
    defaults: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' },
    description: 'Charge deux encodeurs texte. Pour Flux : T5XXL (clip_name1) + CLIP-L (clip_name2), type=flux.',
  },
  {
    type: 'KSamplerSelect',
    category: NodeCategories.sampling,
    title: 'Select Sampler',
    inputs: [],
    outputs: ['SAMPLER'],
    widgets: [
      { name: 'sampler_name', type: 'combo', default: 'euler', label: 'Sampler',
        options: ['euler', 'euler_ancestral', 'heun', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu',
                  'dpmpp_sde', 'lms', 'ddim', 'uni_pc', 'uni_pc_bh2'] },
    ],
    defaults: { sampler_name: 'euler' },
    description: 'Sélectionne l’algorithme d’échantillonnage (pour SamplerCustom).',
  },
  {
    type: 'BasicScheduler',
    category: NodeCategories.sampling,
    title: 'Basic Scheduler',
    inputs: [{ name: 'model', type: 'MODEL' }],
    outputs: ['SIGMAS'],
    widgets: [
      { name: 'scheduler', type: 'combo', default: 'simple', label: 'Scheduler',
        options: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'beta', 'linear_quadratic'] },
      { name: 'steps', type: 'int', min: 1, max: 1000, default: 4, label: 'Steps', required: true },
      { name: 'denoise', type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Denoise', required: true },
    ],
    defaults: { scheduler: 'simple', steps: 4, denoise: 1 },
    description: 'Calcule les niveaux de bruit (sigma) pour SamplerCustom.',
  },
  {
    type: 'SamplerCustom',
    category: NodeCategories.sampling,
    title: 'Sampler Custom',
    inputs: [
      { name: 'model', type: 'MODEL' },
      { name: 'positive', type: 'CONDITIONING' },
      { name: 'negative', type: 'CONDITIONING' },
      { name: 'sampler', type: 'SAMPLER' },
      { name: 'sigmas', type: 'SIGMAS' },
      { name: 'latent_image', type: 'LATENT' },
    ],
    outputs: ['LATENT', 'LATENT'],
    widgets: [
      { name: 'add_noise', type: 'boolean', default: true, label: 'Add Noise', required: true },
      { name: 'noise_seed', type: 'int', min: 0, max: 0xffffffffffffffff, default: 42, label: 'Seed', required: true },
      { name: 'cfg', type: 'float', min: 0, max: 30, step: 0.1, default: 1, label: 'CFG', required: true },
    ],
    defaults: { add_noise: true, noise_seed: 42, cfg: 1 },
    description: 'Échantillonneur modulaire — la voie correcte pour FLUX. ' +
      'Utiliser avec KSamplerSelect + BasicScheduler.',
  },
  {
    type: 'CLIPLoader',
    category: NodeCategories.loaders,
    title: 'Load CLIP (SD 1.5)',
    inputs: [],
    outputs: ['CLIP'],
    widgets: [
      { name: 'clip_name', type: 'dynamic', source: 'clip', label: 'CLIP', required: true,
        default: 'clip_l.safetensors' },
      { name: 'type', type: 'combo', label: 'Type', required: true, default: 'stable_diffusion',
        options: ['stable_diffusion', 'stable_cascade', 'sd3', 'stable_audio', 'mochi', 'ltxv',
                  'pixart', 'cosmos', 'lumina2', 'wan', 'hidream', 'chroma', 'ace',
                  'omnigen2', 'qwen_image', 'hunyuan_image', 'flux2', 'ovis', 'longcat_image',
                  'cogvideox', 'lens', 'pixeldit', 'ideogram4', 'krea2'] },
    ],
    defaults: { clip_name: 'clip_l.safetensors', type: 'stable_diffusion' },
    description: 'Charge un seul encodeur texte. ' +
      'SD 1.5 → type = stable_diffusion. ' +
      'FLUX.2 Klein → clip_name = qwen_3_4b.safetensors et type = flux2 ' +
      '(obligatoire : T5XXL/CLIP-L donnent un conditioning de 4096 dim, Klein en attend 3072). ' +
      'FLUX.1 → préférer DualCLIPLoader (T5XXL + CLIP-L).',
  },
  {
    type: 'VAELoader',
    category: NodeCategories.loaders,
    title: 'Load VAE',
    inputs: [],
    outputs: ['VAE'],
    widgets: [
      { name: 'vae_name', type: 'dynamic', source: 'vae', label: 'VAE', required: true, default: 'ae.safetensors' },
    ],
    defaults: { vae_name: 'ae.safetensors' },
    description: 'Charge un VAE pour décoder les latents. Ignorer si le checkpoint fournit déjà un VAE (sortie 2).',
  },
  {
    type: 'LoraLoader',
    category: NodeCategories.loaders,
    title: 'Load LoRA',
    inputs: [{ name: 'model', type: 'MODEL' }, { name: 'clip', type: 'CLIP' }],
    outputs: ['MODEL', 'CLIP'],
    widgets: [
      { name: 'lora_name', type: 'dynamic', source: 'loras', label: 'LoRA', required: true },
      { name: 'strength_model', type: 'float', min: -2, max: 2, step: 0.01, default: 1, label: 'Model Strength' },
      { name: 'strength_clip', type: 'float', min: -2, max: 2, step: 0.01, default: 1, label: 'CLIP Strength' },
    ],
    defaults: { lora_name: '', strength_model: 1, strength_clip: 1 },
    description: 'Applique un LoRA au MODEL et au CLIP. Entrées en minuscules (convention ComfyUI).',
  },
  {
    type: 'ControlNetLoader',
    category: NodeCategories.controlnet,
    title: 'Load ControlNet',
    inputs: [],
    outputs: ['CONTROL_NET'],
    widgets: [
      { name: 'control_net_name', type: 'combo', options: () => ['control_v11p_sd15_canny.safetensors', 'control_v11p_sd15_openpose.safetensors', 'control_v11f1e_sd15_tile.safetensors'], label: 'ControlNet' },
    ],
    defaults: { control_net_name: 'control_v11p_sd15_canny.safetensors' },
    description: 'Load ControlNet model.',
  },

  // ===================== CONDITIONING =====================
  {
    type: 'CLIPTextEncode',
    category: NodeCategories.conditioners,
    title: 'CLIP Text Encode (Prompt)',
    inputs: [{ name: 'clip', type: 'CLIP' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'text', type: 'textarea', placeholder: 'Positive prompt...', rows: 4 },
    ],
    defaults: { text: '' },
    description: 'Encode text prompt using CLIP. Returns CONDITIONING.',
  },
  {
    type: 'CLIPTextEncodeFlux',
    category: NodeCategories.flux,
    title: 'CLIP Text Encode (Flux v2)',
    inputs: [{ name: 'clip', type: 'CLIP' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'clip_l', type: 'textarea', placeholder: 'Prompt pour CLIP-L…', rows: 3, label: 'CLIP-L Text' },
      { name: 't5xxl', type: 'textarea', placeholder: 'Prompt pour T5XXL…', rows: 3, label: 'T5XXL Text' },
      { name: 'guidance', type: 'float', min: 0, max: 20, step: 0.1, default: 3.5, label: 'Guidance', required: true },
    ],
    defaults: { clip_l: '', t5xxl: '', guidance: 3.5 },
    description: 'Encode le texte pour FLUX.2 — deux champs distincts (clip_l ET t5xxl) + guidance. ' +
      'À n’utiliser qu’avec un modèle FLUX.2 (ex. flux-2-klein-4b).',
  },
  {
    type: 'FluxGuidance',
    category: NodeCategories.flux,
    title: 'Flux Guidance',
    inputs: [{ name: 'conditioning', type: 'CONDITIONING' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'guidance', type: 'float', min: 0, max: 20, step: 0.1, default: 3.5, label: 'Guidance', required: true },
    ],
    defaults: { guidance: 3.5 },
    description: 'Applique le guidage FLUX.1 au conditioning avant le sampler.',
  },
  {
    type: 'ConditioningZeroOut',
    category: NodeCategories.conditioners,
    title: 'Zero Out Conditioning',
    inputs: [{ name: 'conditioning', type: 'CONDITIONING' }],
    outputs: ['CONDITIONING'],
    widgets: [],
    defaults: {},
    description: 'Neutralise un conditioning. Sert de prompt négatif pour FLUX.1, ' +
      'qui n’utilise pas de vrai prompt négatif.',
  },
  {
    type: 'RandomNoise',
    category: NodeCategories.sampling,
    title: 'Random Noise',
    inputs: [],
    outputs: ['NOISE'],
    widgets: [
      { name: 'noise_seed', type: 'int', min: 0, max: 0xffffffffffffffff, default: 42, label: 'Seed', required: true },
    ],
    defaults: { noise_seed: 42 },
    description: 'Bruit aléatoire (pour SamplerCustomAdvanced).',
  },
  {
    type: 'ConditioningCombine',
    category: NodeCategories.conditioners,
    title: 'Combine Conditioning',
    inputs: [{ name: 'conditioning_1', type: 'CONDITIONING' }, { name: 'conditioning_2', type: 'CONDITIONING' }],
    outputs: ['CONDITIONING'],
    widgets: [],
    defaults: {},
    description: 'Combine two conditionings (e.g., positive + style).',
  },
  {
    type: 'ConditioningAverage',
    category: NodeCategories.conditioners,
    title: 'Average Conditioning',
    inputs: [
      { name: 'conditioning_to', type: 'CONDITIONING' },
      { name: 'conditioning_from', type: 'CONDITIONING' },
    ],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'conditioning_to_strength', type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Strength' },
    ],
    defaults: { conditioning_to_strength: 1 },
    description: 'Mélange deux conditionings (pondérés par conditioning_to_strength).',
  },
  {
    type: 'ConditioningSetArea',
    category: NodeCategories.conditioners,
    title: 'Set Conditioning Area',
    inputs: [{ name: 'conditioning', type: 'CONDITIONING' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'width', type: 'int', min: 64, max: 2048, step: 64, default: 512 },
      { name: 'height', type: 'int', min: 64, max: 2048, step: 64, default: 512 },
      { name: 'x', type: 'int', min: 0, max: 2048, step: 64, default: 0 },
      { name: 'y', type: 'int', min: 0, max: 2048, step: 64, default: 0 },
      { name: 'strength', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    defaults: { width: 512, height: 512, x: 0, y: 0, strength: 1 },
    description: 'Restrict conditioning to a specific area (for regional prompting).',
  },

  // ===================== SAMPLING =====================
  {
    type: 'KSampler',
    category: NodeCategories.sampling,
    title: 'KSampler',
    inputs: [
      { name: 'model', type: 'MODEL' },
      { name: 'positive', type: 'CONDITIONING' },
      { name: 'negative', type: 'CONDITIONING' },
      { name: 'latent_image', type: 'LATENT' },
    ],
    outputs: ['LATENT'],
    widgets: [
      { name: 'seed', type: 'int', min: 0, max: 0xffffffffffffffff, default: -1, label: 'Seed (-1 = random)' },
      { name: 'steps', type: 'int', min: 1, max: 1000, default: 24 },
      { name: 'cfg', type: 'float', min: 0, max: 30, step: 0.1, default: 7 },
      { name: 'sampler_name', type: 'combo', options: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'heun', 'lms', 'ddim', 'uni_pc', 'uni_pc_bh2'], default: 'euler' },
      { name: 'scheduler', type: 'combo', options: ['simple', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'normal'], default: 'simple' },
      { name: 'denoise', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    defaults: { seed: -1, steps: 24, cfg: 7, sampler_name: 'euler', scheduler: 'simple', denoise: 1 },
    description: 'Main sampler node. Connect positive/negative conditioning and latent.',
  },
  {
    type: 'KSamplerAdvanced',
    category: NodeCategories.sampling,
    title: 'KSampler Advanced (SD)',
    inputs: [
      { name: 'model', type: 'MODEL' },
      { name: 'positive', type: 'CONDITIONING' },
      { name: 'negative', type: 'CONDITIONING' },
      { name: 'latent_image', type: 'LATENT' },
    ],
    outputs: ['LATENT', 'LATENT'],
    widgets: [
      // ComfyUI attend des LITTERAUX "enable"/"disable", pas des booleens
      { name: 'add_noise', type: 'combo', options: ['enable', 'disable'], default: 'enable', label: 'Add Noise', required: true },
      { name: 'noise_seed', type: 'int', min: 0, max: 0xffffffffffffffff, default: 42, label: 'Seed', required: true },
      { name: 'steps', type: 'int', min: 1, max: 1000, default: 24, label: 'Steps', required: true },
      { name: 'cfg', type: 'float', min: 0, max: 30, step: 0.1, default: 7, label: 'CFG', required: true },
      { name: 'sampler_name', type: 'combo', options: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'heun', 'lms', 'ddim'], default: 'euler', label: 'Sampler', required: true },
      { name: 'scheduler', type: 'combo', options: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform'], default: 'normal', label: 'Scheduler', required: true },
      { name: 'start_at_step', type: 'int', min: 0, max: 10000, default: 0, label: 'Start At', required: true },
      { name: 'end_at_step', type: 'int', min: 0, max: 10000, default: 20, label: 'End At', required: true },
      { name: 'return_with_leftover_noise', type: 'combo', options: ['disable', 'enable'], default: 'disable', label: 'Leftover Noise' },
    ],
    defaults: { add_noise: 'enable', noise_seed: 42, steps: 24, cfg: 7, sampler_name: 'euler', scheduler: 'normal', start_at_step: 0, end_at_step: 20, return_with_leftover_noise: 'disable' },
    description: 'Sampler avancé avec plage d’étapes. add_noise / return_with_leftover_noise ' +
      'prennent des valeurs textuelles "enable"/"disable". Pour FLUX, préférez SamplerCustom.',
  },

  // ===================== LATENT =====================
  {
    type: 'EmptyLatentImage',
    category: NodeCategories.latent,
    title: 'Empty Latent (SDXL/SD1.5)',
    inputs: [],
    outputs: ['LATENT'],
    widgets: [
      { name: 'width', type: 'int', min: 64, max: 2048, step: 64, default: 1024 },
      { name: 'height', type: 'int', min: 64, max: 2048, step: 64, default: 1024 },
      { name: 'batch_size', type: 'int', min: 1, max: 64, default: 1 },
    ],
    defaults: { width: 1024, height: 1024, batch_size: 1 },
    description: 'Create empty latent for SDXL/SD 1.5.',
  },
  {
    type: 'EmptyFlux2LatentImage',
    category: NodeCategories.flux,
    title: 'Empty Latent (Flux)',
    inputs: [],
    outputs: ['LATENT'],
    widgets: [
      { name: 'width', type: 'int', min: 64, max: 2048, step: 16, default: 768 },
      { name: 'height', type: 'int', min: 64, max: 2048, step: 16, default: 1152 },
      { name: 'batch_size', type: 'int', min: 1, max: 4, default: 1 },
    ],
    defaults: { width: 768, height: 1152, batch_size: 1 },
    description: 'Create empty latent for Flux (16px aligned).',
  },
  {
    type: 'LatentUpscale',
    category: NodeCategories.latent,
    title: 'Latent Upscale',
    inputs: [{ name: 'samples', type: 'LATENT' }],
    outputs: ['LATENT'],
    widgets: [
      { name: 'upscale_method', type: 'combo', label: 'Method', required: true, default: 'bilinear',
        options: ['nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp'] },
      { name: 'width', type: 'int', min: 16, max: 8192, step: 16, default: 1536, label: 'Width', required: true },
      { name: 'height', type: 'int', min: 16, max: 8192, step: 16, default: 1536, label: 'Height', required: true },
      { name: 'crop', type: 'combo', label: 'Crop', required: true, default: 'disabled',
        options: ['disabled', 'center'] },
    ],
    defaults: { upscale_method: 'bilinear', width: 1536, height: 1536, crop: 'disabled' },
    description: 'Agrandit un latent à une taille cible (pixels explicites, pas un facteur).',
  },
  {
    type: 'LatentComposite',
    category: NodeCategories.latent,
    title: 'Latent Composite',
    inputs: [
      { name: 'samples_to', type: 'LATENT' },
      { name: 'samples_from', type: 'LATENT' },
    ],
    outputs: ['LATENT'],
    widgets: [
      { name: 'x', type: 'int', min: -4096, max: 4096, default: 0, label: 'X', required: true },
      { name: 'y', type: 'int', min: -4096, max: 4096, default: 0, label: 'Y', required: true },
      { name: 'feather', type: 'int', min: 0, max: 4096, default: 0, label: 'Feather', required: true },
    ],
    defaults: { x: 0, y: 0, feather: 0 },
    description: 'Colle samples_from sur samples_to à (x, y) avec un plumage (feather).',
  },

  // ===================== VAE =====================
  {
    type: 'VAEDecode',
    category: NodeCategories.vae,
    title: 'VAE Decode',
    inputs: [{ name: 'samples', type: 'LATENT' }, { name: 'vae', type: 'VAE' }],
    outputs: ['IMAGE'],
    widgets: [],
    defaults: {},
    description: 'Decode latent to pixel image using VAE.',
  },
  {
    type: 'VAEEncode',
    category: NodeCategories.vae,
    title: 'VAE Encode',
    inputs: [{ name: 'pixels', type: 'IMAGE' }, { name: 'vae', type: 'VAE' }],
    outputs: ['LATENT'],
    widgets: [],
    defaults: {},
    description: 'Encode pixel image to latent using VAE.',
  },

  // ===================== FLUX STUDIO CACHE =====================
  {
    type: 'FluxStudioCachedConditioning',
    category: 'conditioning',
    title: 'Cached Conditioning',
    inputs: [{ name: 'clip', type: 'CLIP' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'text', type: 'textarea', default: '', label: 'Text', required: true },
      { name: 'cache_name', type: 'text', default: '', label: 'Cache Name' },
      { name: 'force_reencode', type: 'boolean', default: false, label: 'Force Re-encode' },
    ],
    defaults: { text: '', cache_name: '', force_reencode: false },
    description: 'Encode un prompt via CLIP avec cache disque (gain ~30s sur itérations).',
  },
  // ===================== IMAGE =====================
  {
    type: 'LoadImage',
    category: NodeCategories.image,
    title: 'Load Image',
    inputs: [],
    outputs: ['IMAGE', 'MASK'],
    widgets: [
      { name: 'image', type: 'file', label: 'Image' },
      { name: 'upload', type: 'button', label: 'Upload', action: 'upload' },
    ],
    defaults: { image: '' },
    description: 'Load image from file system or upload.',
  },
  {
    type: 'SaveImage',
    category: NodeCategories.image,
    title: 'Save Image',
    inputs: [{ name: 'images', type: 'IMAGE' }],
    outputs: [],
    output_node: true,
    widgets: [
      { name: 'filename_prefix', type: 'text', default: 'flux_studio', label: 'Filename Prefix', required: true },
    ],
    defaults: { filename_prefix: 'flux_studio' },
    description: 'Enregistre l’image générée dans le dossier output de ComfyUI.',
  },
  {
    type: 'PreviewImage',
    category: NodeCategories.image,
    title: 'Preview Image',
    inputs: [{ name: 'images', type: 'IMAGE' }],
    outputs: ['IMAGE'],
    output_node: true,
    widgets: [],
    defaults: {},
    description: 'Affiche l’image dans la galerie Flux Studio (sans l’enregistrer).',
  },
  {
    type: 'ImageScale',
    category: NodeCategories.image,
    title: 'Image Scale',
    inputs: [{ name: 'image', type: 'IMAGE' }],
    outputs: ['IMAGE'],
    widgets: [
      { name: 'upscale_method', type: 'combo', label: 'Method', required: true, default: 'lanczos',
        options: ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'] },
      { name: 'width', type: 'int', min: 16, max: 8192, step: 8, default: 1024, label: 'Width', required: true },
      { name: 'height', type: 'int', min: 16, max: 8192, step: 8, default: 1024, label: 'Height', required: true },
      { name: 'crop', type: 'combo', label: 'Crop', required: true, default: 'disabled',
        options: ['disabled', 'center'] },
    ],
    defaults: { upscale_method: 'lanczos', width: 1024, height: 1024, crop: 'disabled' },
    description: 'Redimensionne une image à une taille cible.',
  },
  {
    type: 'ImageBlend',
    category: NodeCategories.image,
    title: 'Image Blend',
    inputs: [{ name: 'image1', type: 'IMAGE' }, { name: 'image2', type: 'IMAGE' }],
    outputs: ['IMAGE'],
    widgets: [
      { name: 'blend_factor', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Blend Factor', required: true },
      { name: 'blend_mode', type: 'combo', label: 'Mode', required: true, default: 'normal',
        options: ['normal', 'multiply', 'screen', 'overlay', 'soft_light', 'hard_light', 'difference'] },
    ],
    defaults: { blend_factor: 0.5, blend_mode: 'normal' },
    description: 'Mélange deux images. blend_factor 0 = image1 entière, 1 = image2 entière.',
  },

  // ===================== UPSCALE =====================
  {
    type: 'UpscaleModelLoader',
    category: NodeCategories.upscale,
    title: 'Load Upscale Model',
    inputs: [],
    outputs: ['UPSCALE_MODEL'],
    widgets: [
      { name: 'model_name', type: 'dynamic', source: 'upscale_models', label: 'Model', required: true,
        default: '4x-UltraSharp.pth' },
    ],
    defaults: { model_name: '4x-UltraSharp.pth' },
    description: 'Charge un modèle d’upscale (ESRGAN, RealESRGAN, 4x-AnimeSharp…).',
  },
  {
    type: 'ImageUpscaleWithModel',
    category: NodeCategories.upscale,
    title: 'Upscale Image With Model',
    inputs: [{ name: 'image', type: 'IMAGE' }, { name: 'upscale_model', type: 'UPSCALE_MODEL' }],
    outputs: ['IMAGE'],
    widgets: [],
    defaults: {},
    description: 'Upscale image using loaded model.',
  },

  // ===================== CONTROLNET =====================
  {
    type: 'ControlNetApply',
    category: NodeCategories.controlnet,
    title: 'Apply ControlNet',
    inputs: [{ name: 'conditioning', type: 'CONDITIONING' }, { name: 'control_net', type: 'CONTROL_NET' }, { name: 'image', type: 'IMAGE' }],
    outputs: ['CONDITIONING'],
    widgets: [
      { name: 'strength', type: 'float', min: 0, max: 2, step: 0.01, default: 1, label: 'Strength', required: true },
    ],
    defaults: { strength: 1 },
    description: 'Applique un ControlNet sur le conditioning, guidé par une image. ' +
      'Pour un contrôle partiel (start/end percent), utiliser ControlNetApplyAdvanced.',
  },

  // ===================== FLUX SPECIFIC =====================
  {
    type: 'Flux2Scheduler',
    category: NodeCategories.flux,
    title: 'Flux 2 Scheduler',
    inputs: [],
    outputs: ['SIGMAS'],
    widgets: [
      { name: 'steps', type: 'int', min: 1, max: 1000, default: 4, label: 'Steps', required: true },
      { name: 'width', type: 'int', min: 64, max: 8192, step: 16, default: 1024, label: 'Width', required: true },
      { name: 'height', type: 'int', min: 64, max: 8192, step: 16, default: 1024, label: 'Height', required: true },
    ],
    defaults: { steps: 4, width: 1024, height: 1024 },
    description: 'Ordonnanceur des sigmas pour FLUX.2. Prend width/height en entrée ' +
      'parce que le planning de bruit dépend du ratio de l’image — ' +
      'BasicScheduler ne fonctionne pas avec Klein.',
  },
  {
    type: 'CFGGuider',
    category: NodeCategories.sampling,
    title: 'CFG Guider',
    inputs: [
      { name: 'model', type: 'MODEL' },
      { name: 'positive', type: 'CONDITIONING' },
      { name: 'negative', type: 'CONDITIONING' },
    ],
    outputs: ['GUIDER'],
    widgets: [
      { name: 'cfg', type: 'float', min: 0, max: 30, step: 0.1, default: 1, label: 'CFG', required: true },
    ],
    defaults: { cfg: 1 },
    description: 'Regroupe modèle + conditionings + échelle CFG en un « guider » ' +
      'pour SamplerCustomAdvanced.',
  },
  {
    type: 'SamplerCustomAdvanced',
    category: NodeCategories.sampling,
    title: 'Sampler Custom Advanced',
    inputs: [
      { name: 'noise', type: 'NOISE' },
      { name: 'guider', type: 'GUIDER' },
      { name: 'sampler', type: 'SAMPLER' },
      { name: 'sigmas', type: 'SIGMAS' },
      { name: 'latent_image', type: 'LATENT' },
    ],
    outputs: ['LATENT', 'LATENT'],
    widgets: [],
    defaults: {},
    description: 'Échantillonneur guidé. La voie correcte pour FLUX.2 Klein ' +
      '(avec CFGGuider + Flux2Scheduler).',
  },
  {
    type: 'BasicGuider',
    category: NodeCategories.flux,
    title: 'Basic Guider (Flux)',
    inputs: [{ name: 'model', type: 'MODEL' }, { name: 'conditioning', type: 'CONDITIONING' }],
    outputs: ['GUIDER'],
    widgets: [],
    defaults: {},
    description: 'Associe un modèle et un conditioning en un « guider » (pour SamplerCustomAdvanced).',
  },
  {
    type: 'ConditioningConcat',
    category: NodeCategories.conditioners,
    title: 'Concat Conditioning',
    inputs: [
      { name: 'conditioning_to', type: 'CONDITIONING' },
      { name: 'conditioning_from', type: 'CONDITIONING' },
    ],
    outputs: ['CONDITIONING'],
    widgets: [],
    defaults: {},
    description: 'Empile deux conditionings (style + contenu) sans les mélanger.',
  },

  // ===================== UTILS =====================
  {
    type: 'PrimitiveNode',
    category: NodeCategories.utils,
    title: 'Primitive (Int/Float/String/Boolean)',
    inputs: [],
    outputs: ['INT', 'FLOAT', 'STRING', 'BOOLEAN'],
    studio_only: true,
    widgets: [
      { name: 'type', type: 'combo', options: ['INT', 'FLOAT', 'STRING', 'BOOLEAN'], default: 'INT' },
      { name: 'value', type: 'text', default: '' },
    ],
    defaults: { type: 'INT', value: '' },
    description: 'Valeur constante câblable. Résolue en littéral à l’export ' +
      '(jamais envoyée à ComfyUI).',
  },
  {
    type: 'Reroute',
    category: NodeCategories.utils,
    title: 'Reroute',
    inputs: ['*'],
    outputs: ['*'],
    studio_only: true,
    widgets: [],
    defaults: {},
    description: 'Regroupe les liens pour unr graphe lisible. Résolu au moment de ' +
      'l’export : la sortie pointe directement sur le nœud amont.',
  },
];

// Helper: get node by type
export function getNode(type) {
  return NodeRegistry.find(n => n.type === type);
}

// Helper: get nodes by category
export function getNodesByCategory(cat) {
  return NodeRegistry.filter(n => n.category === cat);
}

// Helper: all categories with counts
export function getCategories() {
  const counts = {};
  NodeRegistry.forEach(n => { counts[n.category] = (counts[n.category] || 0) + 1; });
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}