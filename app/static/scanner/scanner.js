/**
 * Flux Studio v2 — Local Model Scanner
 * Scans ComfyUI models folders, reads safetensors headers, classifies by architecture
 * Runs in Web Worker for non-blocking UI
 */

import { Signal, effect } from '../core/state.js';
import { bus, Events } from '../core/events.js';

// Architecture detection patterns (same as server-side)
const ARCH_PATTERNS = {
  "Flux.2 Klein 4B": ["double_blocks", "single_blocks", "lora_te1", "lora_te2", "flux", "transformer_blocks", "img_in", "txt_in", "final_layer", "guidance_embedder"],
  "Flux.1 D": ["double_blocks", "single_blocks", "lora_te1", "lora_te2", "flux", "transformer_blocks", "img_in", "txt_in", "final_layer", "guidance_embedder"],
  "SDXL": ["lora_unet", "lora_te1", "lora_te2", "conditioner", "add_embedding", "label_emb", "text_encoders", "transformer_blocks", "down_blocks", "up_blocks", "mid_block", "conv_in", "conv_out", "time_embedding"],
  "Pony": ["lora_unet", "lora_te1", "lora_te2", "pony"],
  "Illustrious": ["lora_unet", "lora_te1", "lora_te2", "illustrious"],
  "NoobAI": ["lora_unet", "lora_te1", "lora_te2", "noobai"],
  "SD 1.5": ["lora_unet", "lora_te", "model.diffusion_model", "cond_stage_model", "first_stage_model", "input_blocks", "output_blocks", "middle_block"],
  "Qwen": ["qwen", "lora_qwen", "transformer_blocks", "patch_embed", "img_in", "txt_in", "final_layer", "guidance_embedder"],
  "Z-Image": ["zimage", "lora_zimage", "double_blocks", "single_blocks"],
  "LTX Video": ["ltx", "lora_ltx", "video", "temporal", "transformer_blocks"],
};

const ARCH_ORDER = [
  "Flux.2 Klein 4B", "Flux.1 D", "Qwen", "Z-Image", "LTX Video",
  "SDXL", "Pony", "Illustrious", "NoobAI", "SD 1.5"
];

const MODEL_FOLDERS = {
  "checkpoints": [".safetensors", ".ckpt", ".pt", ".pth", ".gguf"],
  "loras": [".safetensors", ".pt", ".pth"],
  "vae": [".safetensors", ".pt", ".pth"],
  "controlnet": [".safetensors", ".pth"],
  "clip": [".safetensors", ".gguf"],
  "clip_vision": [".safetensors", ".pt"],
  "unet": [".safetensors", ".pth"],
  "embeddings": [".safetensors", ".pt"],
};

export class ModelScanner {
  constructor(options = {}) {
    this.options = options;
    this.worker = null;
    this.scanning = false;
    this.progress = { current: 0, total: 0, currentFile: '' };
    this.results = [];
    this.callbacks = { onProgress: null, onComplete: null, onError: null };
  }

  async scan(comfyRoot, callbacks = {}) {
    this.callbacks = callbacks;
    this.scanning = true;
    this.results = [];
    
    // Get file list from server
    try {
      const files = await this.getFileList(comfyRoot);
      this.progress.total = files.length;
      this.callbacks.onProgress?.(this.progress);
      
      // Process in batches
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await this.processBatch(batch);
        this.results.push(...results);
        
        this.progress.current = Math.min(i + batchSize, files.length);
        this.callbacks.onProgress?.(this.progress);
      }
      
      this.callbacks.onComplete?.(this.results);
      return this.results;
    } catch (e) {
      this.callbacks.onError?.(e);
      throw e;
    }
  }

  async getFileList(comfyRoot) {
    // This would call the server API to get file list
    // For now, return mock - in real implementation, call /api/comfyui/scan-files
    const res = await fetch('/api/comfyui/scan-files?root=' + encodeURIComponent(comfyRoot));
    return res.json();
  }

  async processBatch(files) {
    const results = [];
    
    for (const file of files) {
      try {
        const metadata = await this.readSafetensorsHeader(file.path);
        const arch = this.detectArchitecture(metadata.metadata, metadata.tensors);
        
        results.push({
          path: file.path,
          name: file.name,
          folder: file.folder,
          size: file.size,
          type: this.inferType(file.folder, file.name),
          base_model: arch,
          metadata: metadata.metadata,
          tensors: metadata.tensors?.slice(0, 20), // Limit stored tensors
        });
      } catch (e) {
        results.push({
          path: file.path,
          name: file.name,
          folder: file.folder,
          size: file.size,
          type: this.inferType(file.folder, file.name),
          base_model: 'Inconnu',
          error: e.message,
        });
      }
    }
    
    return results;
  }

  async readSafetensorsHeader(filepath) {
    // Read first 8 bytes (header size) + header JSON
    const response = await fetch('/api/comfyui/read-header', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filepath }),
    });
    
    if (!response.ok) throw new Error('Failed to read header');
    return response.json();
  }

  detectArchitecture(metadata, tensors) {
    const metaStr = JSON.stringify(metadata || {}).toLowerCase();
    const tensorStr = (tensors || []).join(' ').toLowerCase();
    
    // Check metadata first
    for (const base of ARCH_ORDER) {
      const patterns = ARCH_PATTERNS[base] || [];
      for (const p of patterns) {
        if (metaStr.includes(p.toLowerCase())) return base;
      }
    }
    
    // Check tensor names
    const scores = {};
    for (const base of ARCH_ORDER) {
      const patterns = ARCH_PATTERNS[base] || [];
      let score = 0;
      for (const p of patterns) {
        if (tensorStr.includes(p.toLowerCase())) score++;
      }
      if (score > 0) scores[base] = score;
    }
    
    if (Object.keys(scores).length > 0) {
      return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    }
    
    return 'Inconnu';
  }

  inferType(folder, filename) {
    if (folder === 'loras') return 'LORA';
    if (folder === 'checkpoints') return 'Checkpoint';
    if (folder === 'vae') return 'VAE';
    if (folder === 'controlnet') return 'ControlNet';
    if (folder === 'clip') return 'CLIP';
    if (folder === 'embeddings') return 'Embedding';
    if (filename.includes('controlnet')) return 'ControlNet';
    return 'Other';
  }
}

// Web Worker version for heavy scanning
const scannerWorkerCode = `
  const ARCH_PATTERNS = ${JSON.stringify(ARCH_PATTERNS)};
  const ARCH_ORDER = ${JSON.stringify(ARCH_ORDER)};
  
  function detectArchitecture(metadata, tensors) {
    const metaStr = JSON.stringify(metadata || {}).toLowerCase();
    const tensorStr = (tensors || []).join(' ').toLowerCase();
    
    for (const base of ARCH_ORDER) {
      const patterns = ARCH_PATTERNS[base] || [];
      for (const p of patterns) {
        if (metaStr.includes(p.toLowerCase())) return base;
      }
    }
    
    const scores = {};
    for (const base of ARCH_ORDER) {
      const patterns = ARCH_PATTERNS[base] || [];
      let score = 0;
      for (const p of patterns) {
        if (tensorStr.includes(p.toLowerCase())) score++;
      }
      if (score > 0) scores[base] = score;
    }
    
    if (Object.keys(scores).length > 0) {
      return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    }
    return 'Inconnu';
  }
  
  self.onmessage = async (e) => {
    const { type, files } = e.data;
    if (type === 'scan') {
      const results = [];
      for (const file of files) {
        try {
          // File reading would happen here in worker
          // For now, post progress
          self.postMessage({ type: 'progress', file: file.name });
          results.push({ ...file, base_model: 'Inconnu' });
        } catch (e) {
          results.push({ ...file, base_model: 'Inconnu', error: e.message });
        }
      }
      self.postMessage({ type: 'complete', results });
    }
  };
`;

// Create worker blob URL
export function createScannerWorker() {
  const blob = new Blob([scannerWorkerCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export async function scanModels(comfyRoot, callbacks) {
  const scanner = new ModelScanner();
  return scanner.scan(comfyRoot, callbacks);
}

export { ARCH_PATTERNS, ARCH_ORDER };