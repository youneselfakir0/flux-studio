/**
 * Flux Studio v2 — Builder de workflows
 *
 * Prend une entrée du catalogue (workflows/catalog.js) et construit
 * automatiquement le graphe complet dans l'éditeur. Un clic = tout câblé.
 */

import { graph } from '../editor/graph.js';
import { findWorkflow, resolveModelName } from './catalog.js';

/* ------------------------------------------------------------------ *
 * Catalogue des modeles reels.
 *
 * ComfyUI valide chaque nom de fichier contre SA liste interne et
 * refuse au moindre ecart ("Value not in list"). Sous Windows cette
 * liste utilise des separateurs "\" alors que les chemins ecrits a la
 * main dans le catalogue utilisent "/". Chaque nom passe donc par
 * resolveModelName(), qui rend la chaine officielle.
 * ------------------------------------------------------------------ */
let _modelsPromise = null;
let _models = {};

/* ---------- Cache d'encodeur (custom node ComfyUI) ---------- */
let _cacheNodeAvailable = false;
let _cacheNodePromise = null;

export async function primeCacheNode() {
  if (_cacheNodePromise) return _cacheNodePromise;
  _cacheNodePromise = (async () => {
    try {
      const r = await fetch('http://127.0.0.1:8188/object_info');
      const j = await r.json();
      _cacheNodeAvailable = !!j['FluxStudioCachedConditioning'];
      console.log('[builder] cache node:', _cacheNodeAvailable);
    } catch (e) {
      _cacheNodeAvailable = false;
    }
    return _cacheNodeAvailable;
  })();
  return _cacheNodePromise;
}

export function cacheNodeAvailable() { return _cacheNodeAvailable; }

function loadModels() {
  if (!_modelsPromise) {
    _modelsPromise = fetch('/api/comfyui/models')
      .then(r => r.json())
      .then(j => { _models = j || {}; return _models; })
      .catch(() => { _models = {}; return _models; });
  }
  return _modelsPromise;
}

/**
 * Alimente le cache modeles. A appeler une fois au demarrage (le panneau
 * « pret a l'emploi » le fait deja) : ensuite les builders restent
 * synchrones et renvoient toujours le nom officiel de ComfyUI.
 */
export function setModels(models) {
  if (models && Object.keys(models).length) _models = models;
  return _models;
}

export function primeModels() {
  return loadModels();
}

/** Renvoie le nom exact attendu par ComfyUI pour (categorie, nom). */
function rn(category, name) {
  if (!name) return name;
  const exact = resolveModelName(category, name, _models);
  if (exact !== name && !Object.keys(_models).length) {
    console.warn('[builder] catalogue modeles vide : nom brut envoye pour', name);
  }
  return exact;
}

/** Applique un workflow du catalogue : construit ET câble tout. */
export function applyCatalogWorkflow(id) {
  const wf = findWorkflow(id);
  if (!wf) throw new Error(`Workflow inconnu : ${id}`);
  const g = wf.graph || {};
  const ENC = _cacheNodeAvailable ? 'FluxStudioCachedConditioning' : 'CLIPTextEncode';
  graph.clear();

  const pos = (x, y) => ({ x, y });

  /* ---------- Pipeline FLUX.2 (Klein) ----------
   * Différences avec FLUX.1 : encodeur Qwen (type=flux2), Flux2Scheduler,
   * CFGGuider + SamplerCustomAdvanced au lieu de BasicScheduler + SamplerCustom. */
  if (g.kind === 'flux2') {
    const unet = graph.addNode('UNETLoader', pos(60, 260));
    unet.setWidget('unet_name', rn('diffusion_models', g.unet.name));
    unet.setWidget('weight_dtype', g.unet.dtype || 'default');

    const clip = graph.addNode('CLIPLoader', pos(60, 480));
    clip.setWidget('clip_name', rn('clip', g.clip.name));
    clip.setWidget('type', g.clip.kind || 'flux2');

    const pPos = graph.addNode(ENC, pos(440, 120));
    pPos.setWidget('text', wf.prompt || g.prompt || '');
    if (_cacheNodeAvailable) pPos.setWidget('cache_name', g.unet?.name || g.loader?.ckpt || 'base');
    /* Distillé ⇒ cfg=1. On réutilise pPos pour negative. */
    const pNeg = pPos;

    const lat = graph.addNode(g.latent.type, pos(440, 540));
    lat.setWidget('width', g.latent.width);
    lat.setWidget('height', g.latent.height);
    lat.setWidget('batch_size', 1);

    const pick = graph.addNode('KSamplerSelect', pos(780, 700));
    pick.setWidget('sampler_name', 'euler');

    // Flux2Scheduler prend width/height : indispensable pour Klein
    const sched = graph.addNode('Flux2Scheduler', pos(780, 820));
    sched.setWidget('steps', g.steps ?? 4);
    sched.setWidget('width', g.latent.width);
    sched.setWidget('height', g.latent.height);

    const noise = graph.addNode('RandomNoise', pos(780, 400));
    noise.setWidget('noise_seed', 42);

    const guider = graph.addNode('CFGGuider', pos(1040, 240));
    guider.setWidget('cfg', g.cfg ?? 1);

    const sampler = graph.addNode('SamplerCustomAdvanced', pos(1300, 300));

    const vae = graph.addNode('VAELoader', pos(1040, 700));
    vae.setWidget('vae_name', rn('vae', g.vae.name));

    const decode = graph.addNode('VAEDecode', pos(1560, 300));
    const save = graph.addNode('SaveImage', pos(1820, 300));
    save.setWidget('filename_prefix', 'flux_studio');

    graph.connect(clip.id, 'CLIP', pPos.id, 'clip');
    graph.connect(unet.id, 'MODEL', guider.id, 'model');
    graph.connect(pPos.id, 'CONDITIONING', guider.id, 'positive');
    graph.connect(pNeg.id, 'CONDITIONING', guider.id, 'negative');
    graph.connect(noise.id, 'NOISE', sampler.id, 'noise');
    graph.connect(guider.id, 'GUIDER', sampler.id, 'guider');
    graph.connect(pick.id, 'SAMPLER', sampler.id, 'sampler');
    graph.connect(sched.id, 'SIGMAS', sampler.id, 'sigmas');
    graph.connect(lat.id, 'LATENT', sampler.id, 'latent_image');
    graph.connect(sampler.id, 'LATENT', decode.id, 'samples');
    graph.connect(vae.id, 'VAE', decode.id, 'vae');
    graph.connect(decode.id, 'IMAGE', save.id, 'images');

    if (g.loraNode && wf.loras && wf.loras.length) {
      const modelConn = srcOf(guider, 'model');
      const clipConn = srcOf(pPos, 'clip');
      applyLora(
        wf.loras[0].path,
        g.loraNode.strength_model, g.loraNode.strength_clip,
        [
          { node: guider, input: 'model', conn: modelConn },
          { node: pPos, input: 'clip', conn: clipConn },
          { node: pNeg, input: 'clip', conn: null },
        ],
        320, 800
      );
    }

    return { nodes: graph.getAllNodes().length, edges: graph.getEdges().length };
  }

  /* ---------- Pipeline FLUX.1 ---------- */
  if (g.unet) {
    const unet = graph.addNode('UNETLoader', pos(60, 260));
    unet.setWidget('unet_name', rn('diffusion_models', g.unet.name));
    unet.setWidget('weight_dtype', g.unet.dtype || 'default');

    const clip = graph.addNode('DualCLIPLoader', pos(60, 480));
    clip.setWidget('clip_name1', rn('clip', g.clip.clip1));
    clip.setWidget('clip_name2', rn('clip', g.clip.clip2));
    clip.setWidget('type', g.clip.kind || 'flux');

    const pPos = graph.addNode(ENC, pos(420, 120));
    pPos.setWidget('text', wf.prompt || g.prompt || '');
    if (_cacheNodeAvailable) pPos.setWidget('cache_name', g.unet?.name || g.loader?.ckpt || 'base');
    const pNeg = graph.addNode(ENC, pos(420, 320));
    pNeg.setWidget('text', wf.negative || g.negative || '');
    if (_cacheNodeAvailable) pNeg.setWidget('cache_name', g.unet?.name || g.loader?.ckpt || 'base');

    const lat = graph.addNode(g.latent.type, pos(420, 540));
    lat.setWidget('width', g.latent.width);
    lat.setWidget('height', g.latent.height);
    lat.setWidget('batch_size', 1);

    const pick = graph.addNode('KSamplerSelect', pos(760, 700));
    pick.setWidget('sampler_name', g.samplerSelect.name);

    const sched = graph.addNode('BasicScheduler', pos(760, 810));
    sched.setWidget('scheduler', g.scheduler.kind);
    sched.setWidget('steps', g.scheduler.steps);
    sched.setWidget('denoise', g.scheduler.denoise);

    const sampler = graph.addNode('SamplerCustom', pos(760, 300));
    sampler.setWidget('add_noise', g.sampler.add_noise);
    sampler.setWidget('noise_seed', g.sampler.seed);
    sampler.setWidget('cfg', g.sampler.cfg);

    const vae = graph.addNode('VAELoader', pos(1060, 700));
    vae.setWidget('vae_name', rn('vae', g.vae.name));

    const decode = graph.addNode('VAEDecode', pos(1360, 300));
    const save = graph.addNode('SaveImage', pos(1640, 300));
    save.setWidget('filename_prefix', 'flux_studio');

    graph.connect(clip.id, 'CLIP', pPos.id, 'clip');
    graph.connect(clip.id, 'CLIP', pNeg.id, 'clip');
    graph.connect(unet.id, 'MODEL', sched.id, 'model');
    graph.connect(unet.id, 'MODEL', sampler.id, 'model');
    graph.connect(pPos.id, 'CONDITIONING', sampler.id, 'positive');
    graph.connect(pNeg.id, 'CONDITIONING', sampler.id, 'negative');
    graph.connect(pick.id, 'SAMPLER', sampler.id, 'sampler');
    graph.connect(sched.id, 'SIGMAS', sampler.id, 'sigmas');
    graph.connect(lat.id, 'LATENT', sampler.id, 'latent_image');
    graph.connect(sampler.id, 'LATENT', decode.id, 'samples');
    graph.connect(vae.id, 'VAE', decode.id, 'vae');
    graph.connect(decode.id, 'IMAGE', save.id, 'images');

    // LoRA optionnel : intercepte MODEL (sampler + scheduler) et CLIP (2 encodeurs)
    if (g.loraNode && wf.loras && wf.loras.length) {
      const modelConn = srcOf(sampler, 'model');
      const clipConn = srcOf(pPos, 'clip');
      applyLora(
        wf.loras[0].path,
        g.loraNode.strength_model, g.loraNode.strength_clip,
        [
          { node: sampler, input: 'model', conn: modelConn },
          { node: sched, input: 'model', conn: null },
          { node: pPos, input: 'clip', conn: clipConn },
          { node: pNeg, input: 'clip', conn: null },
        ],
        320, 800
      );
    }

    return { nodes: graph.getAllNodes().length, edges: graph.getEdges().length };
  }

  /* ---------- Pipeline Checkpoint (SDXL / SD 1.5) ---------- */
  if (g.loader) {
    const ckpt = graph.addNode('CheckpointLoaderSimple', pos(80, 260));
    ckpt.setWidget('ckpt_name', rn('checkpoints', g.loader.ckpt));

    const pPos = graph.addNode(ENC, pos(440, 120));
    pPos.setWidget('text', wf.prompt || g.prompt || '');
    if (_cacheNodeAvailable) pPos.setWidget('cache_name', g.unet?.name || g.loader?.ckpt || 'base');
    const pNeg = graph.addNode(ENC, pos(440, 320));
    pNeg.setWidget('text', wf.negative || g.negative || '');
    if (_cacheNodeAvailable) pNeg.setWidget('cache_name', g.unet?.name || g.loader?.ckpt || 'base');

    const lat = graph.addNode(g.latent.type, pos(440, 540));
    lat.setWidget('width', g.latent.width);
    lat.setWidget('height', g.latent.height);
    lat.setWidget('batch_size', 1);

    const sampler = graph.addNode('KSampler', pos(800, 300));
    sampler.setWidget('steps', g.sampler.steps);
    sampler.setWidget('cfg', g.sampler.cfg);
    sampler.setWidget('sampler_name', g.sampler.sampler);
    sampler.setWidget('scheduler', g.sampler.scheduler);
    sampler.setWidget('seed', 42);
    sampler.setWidget('denoise', 1);

    const decode = graph.addNode('VAEDecode', pos(1140, 300));
    const save = graph.addNode('SaveImage', pos(1420, 300));
    save.setWidget('filename_prefix', 'flux_studio');

    graph.connect(ckpt.id, 'CLIP', pPos.id, 'clip');
    graph.connect(ckpt.id, 'CLIP', pNeg.id, 'clip');
    graph.connect(ckpt.id, 'MODEL', sampler.id, 'model');
    graph.connect(pPos.id, 'CONDITIONING', sampler.id, 'positive');
    graph.connect(pNeg.id, 'CONDITIONING', sampler.id, 'negative');
    graph.connect(lat.id, 'LATENT', sampler.id, 'latent_image');
    graph.connect(sampler.id, 'LATENT', decode.id, 'samples');
    graph.connect(ckpt.id, 'VAE', decode.id, 'vae');
    graph.connect(decode.id, 'IMAGE', save.id, 'images');

    if (g.loraNode && wf.loras && wf.loras.length) {
      const modelConn = srcOf(sampler, 'model');
      const clipConn = srcOf(pPos, 'clip');
      applyLora(
        wf.loras[0].path,
        g.loraNode.strength_model, g.loraNode.strength_clip,
        [
          { node: sampler, input: 'model', conn: modelConn },
          { node: pPos, input: 'clip', conn: clipConn },
          { node: pNeg, input: 'clip', conn: null },
        ],
        320, 780
      );
    }

    return { nodes: graph.getAllNodes().length, edges: graph.getEdges().length };
  }

  /* ---------- Utility : upscale ---------- */
  if (wf.isUtility) {
    const load = graph.addNode('LoadImage', pos(120, 300));
    const model = graph.addNode('UpscaleModelLoader', pos(120, 520));
    model.setWidget('model_name', rn('upscale_models', wf.upscaler));
    const up = graph.addNode('ImageUpscaleWithModel', pos(600, 380));
    const save = graph.addNode('SaveImage', pos(880, 380));
    save.setWidget('filename_prefix', 'flux_studio/upscale');

    graph.connect(load.id, 'IMAGE', up.id, 'image');
    graph.connect(model.id, 'UPSCALE_MODEL', up.id, 'upscale_model');
    graph.connect(up.id, 'IMAGE', save.id, 'images');
    return { nodes: graph.getAllNodes().length, edges: graph.getEdges().length };
  }

  throw new Error('Workflow sans définition de graphe');
}

/**
 * Insère un nÅ“ud LoraLoader entre la source (MODÃƒË†LE/CLIP) et le sampler.
 * Coupe les connexions existantes et les rebranche via le LoRA.
 */
/**
 * Insère un LoraLoader dans le pipeline.
 *
 * `targets` = liste de { node, input } à rerouter. Pour chaque target on
 * prend la source existante, on la branche sur le LoRA, puis on relie la
 * sortie du LoRA vers la cible. (Le CLIP peut devoir alimenter plusieurs
 * cibles : text encoders + sampler.)
 */
function applyLora(loraPath, strengthModel, strengthClip, targets, x = 320, y = 780) {
  const lora = graph.addNode('LoraLoader', { x, y });
  lora.setWidget('lora_name', rn('loras', loraPath));
  lora.setWidget('strength_model', strengthModel ?? 1);
  lora.setWidget('strength_clip', strengthClip ?? 1);

  // Les ports LoraLoader sont en minuscules, mais les cibles peuvent être
  // nommées MODEL/CLIP selon le nÅ“ud -> comparaison insensible à la casse.
  const isKind = (t, kind) => String(t.input).toLowerCase() === kind;
  const modelTargets = targets.filter(t => isKind(t, 'model'));
  const clipTargets = targets.filter(t => isKind(t, 'clip'));
  const modelSrc = modelTargets.find(t => t.conn) || null;
  const clipSrc = clipTargets.find(t => t.conn) || null;

  if (modelSrc) {
    const { conn } = modelSrc;
    graph.disconnect(conn.nodeId, conn.outputName, modelSrc.node.id, modelSrc.input);
    graph.connect(conn.nodeId, conn.outputName, lora.id, 'model');
    modelTargets.forEach(t => graph.connect(lora.id, 'MODEL', t.node.id, t.input));
  }
  if (clipSrc) {
    const { conn } = clipSrc;
    graph.disconnect(conn.nodeId, conn.outputName, clipSrc.node.id, clipSrc.input);
    graph.connect(conn.nodeId, conn.outputName, lora.id, 'clip');
    clipTargets.forEach(t => graph.connect(lora.id, 'CLIP', t.node.id, t.input));
  }

  // Sécurité : si une cible n'a reçu aucune source, on laisse le LoRA orphelin
  // plutôt que de produire un graphe invalide silencieux.
  if (!modelSrc || !clipSrc) {
    console.warn('[builder] LoRA incomplet', {
      model: !!modelSrc, clip: !!clipSrc,
      targets: targets.map(t => `${t.node.type}.${t.input}`),
    });
  }
  return lora;
}

/** Lit la source actuellement branchée sur une entrée. */
function srcOf(node, input) {
  const port = node.inputs.get(input);
  if (!port || !port.connections.size) return null;
  return [...port.connections][0];
}




