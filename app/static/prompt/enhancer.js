/**
 * Flux Studio v2 — Prompt Enhancer
 * Gemini-powered prompt enhancement, style transfer, weighting, negative generation
 */

import { Signal, effect, derived } from '../core/state.js';
import { bus, Events } from '../core/events.js';
import { api } from '../core/api.js';

export class PromptEnhancer {
  constructor(options = {}) {
    this.options = options;
    
    this.currentPrompt = new Signal('');
    this.enhancedPrompt = new Signal('');
    this.negativePrompt = new Signal('');
    this.style = new Signal('photorealistic');
    this.enhancing = new Signal(false);
    this.history = new Signal([]);
    this.templates = new Signal([
      { name: 'Portrait', prompt: 'portrait of a beautiful woman, detailed face, perfect skin, professional lighting, 85mm lens, shallow depth of field', category: 'portrait' },
      { name: 'Fashion', prompt: 'fashion photography, stunning model, haute couture, dramatic lighting, editorial style, high fashion magazine cover', category: 'fashion' },
      { name: 'Cinematic', prompt: 'cinematic shot, beautiful woman, movie still, dramatic lighting, color grading, anamorphic lens, 2.39:1', category: 'cinematic' },
      { name: 'Fantasy', prompt: 'fantasy art, ethereal woman, magical atmosphere, bioluminescent, intricate details, digital painting, artstation trending', category: 'fantasy' },
      { name: 'Anime', prompt: 'anime style, beautiful girl, detailed eyes, cel shading, vibrant colors, studio ghibli style, makoto shinkai lighting', category: 'anime' },
      { name: 'Cyberpunk', prompt: 'cyberpunk woman, neon lights, futuristic city, rain, reflections, high tech low life, blade runner aesthetic', category: 'cyberpunk' },
      { name: 'Nature', prompt: 'outdoor portrait, beautiful woman in nature, golden hour, soft sunlight, flowers, natural beauty, national geographic style', category: 'nature' },
      { name: 'Abstract', prompt: 'abstract art, woman silhouette, geometric shapes, vibrant colors, minimalist, bauhaus style, modern art', category: 'abstract' },
    ]);
  }

  async enhance(prompt, options = {}) {
    const opts = {
      style: this.style.value,
      detailLevel: 'high',
      addLighting: true,
      addCamera: true,
      addQuality: true,
      addNegative: true,
      ...options,
    };
    
    this.enhancing.value = true;
    
    try {
      const systemPrompt = this.buildSystemPrompt(opts);
      const userPrompt = `Enhance this prompt for AI image generation (Flux/SDXL): "${prompt}"`;
      
      const response = await this.callGemini(systemPrompt, userPrompt);
      
      const result = this.parseResponse(response);
      
      this.enhancedPrompt.value = result.positive;
      this.negativePrompt.value = result.negative;
      
      // Add to history
      this.history.value = [
        { original: prompt, enhanced: result.positive, negative: result.negative, style: opts.style, timestamp: Date.now() },
        ...this.history.value.slice(0, 49),
      ];
      
      return result;
    } catch (e) {
      console.error('Enhancement failed:', e);
      throw e;
    } finally {
      this.enhancing.value = false;
    }
  }

  buildSystemPrompt(opts) {
    const styleGuides = {
      photorealistic: 'Photorealistic, hyper-detailed, 8K, raw photo, professional photography, sharp focus, realistic skin texture, natural lighting',
      cinematic: 'Cinematic composition, movie lighting, color grading, anamorphic lens, film grain, dramatic shadows, letterbox',
      fashion: 'High fashion editorial, magazine cover, studio lighting, designer clothing, elegant pose, vogue style',
      fantasy: 'Fantasy art, ethereal, magical, bioluminescent, intricate details, digital painting, artstation, deviantart',
      anime: 'Anime style, cel shaded, vibrant colors, detailed eyes, studio ghibli, makoto shinkai, kyoto animation',
      cyberpunk: 'Cyberpunk aesthetic, neon lights, rain, reflections, high tech low life, blade runner, dystopian',
      nature: 'Natural lighting, golden hour, outdoor, organic, national geographic, wildlife photography',
      abstract: 'Abstract, geometric, minimalist, bauhaus, modern art, vibrant colors, composition',
    };
    
    const styleGuide = styleGuides[opts.style] || styleGuides.photorealistic;
    
    return `You are an expert prompt engineer for AI image generation (Flux, SDXL, Midjourney). 
Your task: Enhance user prompts for maximum quality and specificity.

STYLE GUIDE: ${styleGuide}

RULES:
1. Keep the CORE SUBJECT and INTENT of the original prompt
2. Add specific technical details: camera, lens, lighting, composition
3. Add quality modifiers: resolution, detail level, rendering engine
4. Use proper weighting syntax: (keyword:1.2) for emphasis, [keyword:0.8] for de-emphasis
5. Structure: Subject, Environment, Lighting, Camera, Style, Quality
6. Be specific, not generic. "beautiful woman" → "24-year-old woman with emerald eyes, auburn hair in loose waves, freckled porcelain skin"
7. ${opts.addLighting ? 'Add specific lighting: rim light, key light, fill light, golden hour, studio strobe, natural window light' : ''}
8. ${opts.addCamera ? 'Add camera specs: 85mm f/1.4, 35mm f/2, 24mm wide angle, full frame, medium format' : ''}
9. ${opts.addQuality ? 'Add quality: 8K, 16K, hyper-detailed, sharp focus, masterpiece, best quality, ultra-high definition' : ''}
9. Output format: JSON only with keys "positive" and "negative"

NEGATIVE PROMPT (always include):
- Low quality, blur, distortion, deformation, bad anatomy, extra limbs, missing fingers, watermark, text, signature, username, lowres, pixelated, grain, noise, jpeg artifacts, oversaturated, overexposed, underexposed, bad composition, ugly, deformed, mutation, mutilated
${opts.addNegative ? '' : '- Return empty string for negative'}

Return ONLY valid JSON: {"positive": "...", "negative": "..."}`;
  }

  async callGemini(systemPrompt, userPrompt) {
    // Use the existing /api/comfyui/describe endpoint with Ollama/Gemini
    // For now, we'll use a direct call pattern
    const response = await fetch('/api/comfyui/enhance-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, userPrompt }),
    });
    
    if (!response.ok) throw new Error('Enhancement API error');
    return response.json();
  }

  parseResponse(response) {
    try {
      if (typeof response === 'string') {
        return JSON.parse(response);
      }
      return response;
    } catch {
      return { positive: '', negative: '' };
    }
  }

  // Quick style application
  applyStyle(basePrompt, styleName) {
    const styleModifiers = {
      photorealistic: 'photorealistic, 8K, raw photo, professional photography, sharp focus',
      cinematic: 'cinematic, movie lighting, color grading, anamorphic lens, film grain',
      fashion: 'fashion photography, editorial, haute couture, studio lighting',
      fantasy: 'fantasy art, ethereal, magical, bioluminescent, intricate details, digital painting',
      anime: 'anime style, cel shaded, vibrant colors, detailed eyes, studio ghibli style',
      cyberpunk: 'cyberpunk, neon lights, rain, reflections, blade runner aesthetic',
      nature: 'golden hour, natural lighting, outdoor, national geographic style',
      abstract: 'abstract, geometric, minimalist, vibrant colors, bauhaus',
    };
    
    const modifier = styleModifiers[styleName] || '';
    return `${basePrompt}, ${modifier}`;
  }

  // Weight helpers
  static emphasize(text, weight = 1.2) {
    return `(${text}:${weight})`;
  }
  
  static deemphasize(text, weight = 0.8) {
    return `[${text}:${weight}]`;
  }
  
  static alternate(...options) {
    return `{${options.join('|')}}`;
  }

  // Prompt analysis
  analyze(prompt) {
    const tokens = prompt.split(/[,\s]+/).filter(t => t.length > 2);
    const weights = {};
    
    tokens.forEach(t => {
      const match = t.match(/[\(\[](.+?)[:\d.]*[\)\]]/);
      if (match) weights[match[1]] = parseFloat(t.match(/([\d.]+)\)/)?.[1] || '1');
    });
    
    return {
      tokens: tokens.length,
      weightedTokens: Object.keys(weights).length,
      weights,
      suggestions: this.generateSuggestions(tokens),
    };
  }

  generateSuggestions(tokens) {
    const suggestions = [];
    
    if (!tokens.some(t => /\d+mm/.test(t))) {
      suggestions.push('Add lens: "85mm f/1.4" for portraits, "35mm f/2" for environmental');
    }
    if (!tokens.some(t => /f\/\d/.test(t))) {
      suggestions.push('Add aperture: "f/1.8", "f/2.8", "f/4"');
    }
    if (!tokens.some(t => /light|lighting|illumin/.test(t))) {
      suggestions.push('Add lighting: "soft box lighting", "golden hour", "rim light", "studio strobe"');
    }
    if (!tokens.some(t => /8K|4K|masterpiece|best quality/.test(t))) {
      suggestions.push('Add quality: "8K, masterpiece, best quality, ultra-detailed"');
    }
    if (!tokens.some(t => /portrait|landscape|close.?up|wide.?angle/.test(t))) {
      suggestions.push('Add composition: "portrait orientation", "close-up", "wide angle", "rule of thirds"');
    }
    
    return suggestions;
  }

  // Get history
  getHistory() {
    return this.history.value;
  }

  // Clear history
  clearHistory() {
    this.history.value = [];
  }

  // Apply template
  useTemplate(templateName) {
    const template = this.templates.value.find(t => t.name.toLowerCase() === templateName.toLowerCase());
    if (template) {
      this.currentPrompt.value = template.prompt;
      return template.prompt;
    }
    return null;
  }

  // Get all templates
  getTemplates() {
    return this.templates.value;
  }

  // Add custom template
  addTemplate(name, prompt, category) {
    this.templates.value = [...this.templates.value, { name, prompt, category }];
  }
}

// Lightweight version for inline use
export function enhancePrompt(prompt, style = 'photorealistic') {
  const enhancer = new PromptEnhancer();
  return enhancer.enhance(prompt, { style });
}

export function createPromptEnhancer(options) {
  return new PromptEnhancer(options);
}

// Export for inline use in components
export const PromptUtils = {
  emphasize: (text, weight = 1.2) => `(${text}:${weight})`,
  deemphasize: (text, weight = 0.8) => `[${text}:${weight}]`,
  alternate: (...options) => `{${options.join('|')}}`,
  schedule: (steps, prompts) => {
    // Format: "prompt1:10, prompt2:20, prompt3"
    return prompts.map((p, i) => `${p}:${steps[i] || ''}`).filter(Boolean).join(', ');
  },
  embed: (text, weight) => weight !== 1 ? `((${text}:${weight}))` : text,
};