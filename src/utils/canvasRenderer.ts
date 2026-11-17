import {
  AnimationFrame,
  AnimationLayer,
  CharacterPresetId,
  ChromaKeyConfig,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  EasingType,
  EffectsConfig,
  LayerKeyframe,
  ParticlePreset,
  ShapePresetId,
  StudioProject,
  TextLayerConfig,
} from '../types/studio';
import { DecodedGif, pickGifFrameAtTime } from './gifDecoder';

export interface ResolvedTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

function applyEasing(t: number, easing: EasingType): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'ease-in':
      return clamped * clamped;
    case 'ease-out':
      return 1 - (1 - clamped) * (1 - clamped);
    case 'ease-in-out':
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
    default:
      return clamped;
  }
}

export function interpolateLayerAtFrame(
  layer: AnimationLayer,
  frameIndex: number,
  totalFrames: number
): ResolvedTransform {
  const sorted = [...layer.keyframes].sort((a, b) => a.frameIndex - b.frameIndex);
  if (sorted.length === 0) {
    return { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
  }

  let base: ResolvedTransform;
  if (frameIndex <= sorted[0].frameIndex) {
    const k = sorted[0];
    base = {
      x: k.x,
      y: k.y,
      scaleX: k.scaleX,
      scaleY: k.scaleY,
      rotation: k.rotation,
      opacity: k.opacity,
    };
  } else if (frameIndex >= sorted[sorted.length - 1].frameIndex) {
    const k = sorted[sorted.length - 1];
    base = {
      x: k.x,
      y: k.y,
      scaleX: k.scaleX,
      scaleY: k.scaleY,
      rotation: k.rotation,
      opacity: k.opacity,
    };
  } else {
    let prev: LayerKeyframe = sorted[0];
    let next: LayerKeyframe = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (frameIndex >= sorted[i].frameIndex && frameIndex <= sorted[i + 1].frameIndex) {
        prev = sorted[i];
        next = sorted[i + 1];
        break;
      }
    }
    const span = Math.max(1, next.frameIndex - prev.frameIndex);
    const rawT = (frameIndex - prev.frameIndex) / span;
    const t = applyEasing(rawT, prev.easing || 'linear');
    base = {
      x: prev.x + (next.x - prev.x) * t,
      y: prev.y + (next.y - prev.y) * t,
      scaleX: prev.scaleX + (next.scaleX - prev.scaleX) * t,
      scaleY: prev.scaleY + (next.scaleY - prev.scaleY) * t,
      rotation: prev.rotation + (next.rotation - prev.rotation) * t,
      opacity: prev.opacity + (next.opacity - prev.opacity) * t,
    };
  }

  // Apply procedural motion presets deterministically
  const phase = (frameIndex / Math.max(1, totalFrames)) * Math.PI * 2;
  const amp = layer.motionIntensity || 16;
  switch (layer.motionPreset) {
    case 'bounce':
      base.y -= Math.abs(Math.sin(phase * 2)) * amp * 1.4;
      break;
    case 'float':
      base.y += Math.sin(phase * 2) * amp * 0.8;
      base.rotation += Math.cos(phase * 2) * 3;
      break;
    case 'orbit':
      base.x += Math.cos(phase) * amp * 1.6;
      base.y += Math.sin(phase) * amp * 1.6;
      break;
    case 'shake':
      base.x += Math.sin(frameIndex * 2.7) * (amp * 0.45);
      base.y += Math.cos(frameIndex * 3.1) * (amp * 0.3);
      break;
    case 'pulse': {
      const s = 1 + Math.sin(phase * 2) * (amp / 120);
      base.scaleX *= s;
      base.scaleY *= s;
      break;
    }
    default:
      break;
  }

  return base;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  const num = parseInt(clean.padEnd(6, '0').slice(0, 6), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function applyChromaKeyToImageData(
  imageData: ImageData,
  config: ChromaKeyConfig
): ImageData {
  if (!config.enabled) return imageData;
  const { r: kr, g: kg, b: kb } = hexToRgb(config.keyColor);
  const data = imageData.data;
  const maxDist = 441.67; // sqrt(255^2 * 3)
  const simThresh = (config.similarity / 100) * maxDist * 0.68;
  const smoothSpan = Math.max(1, (config.smoothness / 100) * maxDist * 0.4);
  const spillAmt = config.spill / 100;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);

    if (dist < simThresh) {
      data[i + 3] = 0;
    } else if (dist < simThresh + smoothSpan) {
      const alphaFactor = (dist - simThresh) / smoothSpan;
      data[i + 3] = Math.round(data[i + 3] * alphaFactor);
    }

    if (spillAmt > 0 && data[i + 3] > 0) {
      // Spill suppression toward dominant channel (green or blue)
      if (kg >= kr && kg >= kb) {
        const maxRB = Math.max(r, b);
        if (g > maxRB) {
          data[i + 1] = Math.round(g - (g - maxRB) * spillAmt);
        }
      } else if (kb >= kr && kb >= kg) {
        const maxRG = Math.max(r, g);
        if (b > maxRG) {
          data[i + 2] = Math.round(b - (b - maxRG) * spillAmt);
        }
      }
    }
  }
  return imageData;
}

export function buildCssFilterString(effects: EffectsConfig): string {
  const parts: string[] = [];
  if (effects.brightness !== 100) parts.push(`brightness(${effects.brightness}%)`);
  if (effects.contrast !== 100) parts.push(`contrast(${effects.contrast}%)`);
  if (effects.saturation !== 100) parts.push(`saturate(${effects.saturation}%)`);
  if (effects.blur > 0) parts.push(`blur(${effects.blur}px)`);
  if (effects.hueRotate !== 0) parts.push(`hue-rotate(${effects.hueRotate}deg)`);
  if (effects.sepia > 0) parts.push(`sepia(${effects.sepia}%)`);
  if (effects.grayscale > 0) parts.push(`grayscale(${effects.grayscale}%)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export function applyPostPixelEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effects: EffectsConfig,
  seedFrame = 0
): void {
  if (effects.pixelate > 1) {
    const step = Math.max(2, Math.round(effects.pixelate));
    const smallW = Math.max(1, Math.floor(width / step));
    const smallH = Math.max(1, Math.floor(height / step));
    const temp = document.createElement('canvas');
    temp.width = smallW;
    temp.height = smallH;
    const tctx = temp.getContext('2d');
    if (tctx) {
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(ctx.canvas, 0, 0, smallW, smallH);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(temp, 0, 0, width, height);
      ctx.restore();
    }
  }

  if (effects.glitch > 0) {
    const intensity = (effects.glitch / 100) * 18;
    const slices = 6;
    const img = ctx.getImageData(0, 0, width, height);
    const src = new Uint8ClampedArray(img.data);
    const dst = img.data;
    const shiftPx = Math.round(Math.sin(seedFrame * 1.9 + 1) * intensity);

    for (let y = 0; y < height; y++) {
      const band = Math.floor((y / height) * slices);
      const bandOffset =
        band % 2 === 0
          ? shiftPx
          : -Math.round(shiftPx * 0.65);
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const rx = Math.max(0, Math.min(width - 1, x + bandOffset));
        const bx = Math.max(0, Math.min(width - 1, x - bandOffset));
        dst[idx] = src[(y * width + rx) * 4];
        dst[idx + 2] = src[(y * width + bx) * 4 + 2];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  if (effects.grain > 0) {
    const amount = (effects.grain / 100) * 45;
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    let rng = (seedFrame + 1) * 9301 + 49297;
    for (let i = 0; i < data.length; i += 16) {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const noise = ((rng % 255) / 255 - 0.5) * amount;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(img, 0, 0);
  }

  if (effects.vignette > 0) {
    const alpha = Math.min(0.92, (effects.vignette / 100) * 0.85);
    const rad = Math.max(width, height) * 0.72;
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      rad * 0.35,
      width / 2,
      height / 2,
      rad
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

export function drawCharacterVector(
  ctx: CanvasRenderingContext2D,
  characterId: CharacterPresetId,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  accent: string
): void {
  ctx.save();
  ctx.translate(-w / 2, -h / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, w * 0.025);

  if (characterId === 'astronauta') {
    // Backpack
    ctx.fillStyle = accent;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.roundRect(w * 0.14, h * 0.34, w * 0.72, h * 0.36, 18);
    ctx.fill();
    ctx.stroke();

    // Body
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.24, h * 0.38, w * 0.52, h * 0.38, 22);
    ctx.fill();
    ctx.stroke();

    // Legs
    ctx.beginPath();
    ctx.roundRect(w * 0.27, h * 0.72, w * 0.18, h * 0.22, 10);
    ctx.roundRect(w * 0.55, h * 0.72, w * 0.18, h * 0.22, 10);
    ctx.fill();
    ctx.stroke();

    // Helmet
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.25, w * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Visor
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(w * 0.34, h * 0.16, w * 0.32, h * 0.16, 14);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.21, w * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // Chest badge
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(w * 0.4, h * 0.48, w * 0.2, h * 0.1, 5);
    ctx.fill();
  } else if (characterId === 'robo') {
    // Antenna
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.04);
    ctx.lineTo(w * 0.5, h * 0.14);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.05, w * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.24, h * 0.13, w * 0.52, h * 0.28, 14);
    ctx.fill();
    ctx.stroke();

    // Eyes
    ctx.fillStyle = '#06B6D4';
    ctx.beginPath();
    ctx.arc(w * 0.39, h * 0.25, w * 0.055, 0, Math.PI * 2);
    ctx.arc(w * 0.61, h * 0.25, w * 0.055, 0, Math.PI * 2);
    ctx.fill();

    // Torso
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.22, h * 0.44, w * 0.56, h * 0.34, 16);
    ctx.fill();
    ctx.stroke();

    // Core meter
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(w * 0.33, h * 0.53, w * 0.34, h * 0.14, 8);
    ctx.fill();

    // Legs
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.28, h * 0.79, w * 0.16, h * 0.17, 8);
    ctx.roundRect(w * 0.56, h * 0.79, w * 0.16, h * 0.17, 8);
    ctx.fill();
    ctx.stroke();
  } else if (characterId === 'gato') {
    // Ears
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.26);
    ctx.lineTo(w * 0.2, h * 0.06);
    ctx.lineTo(w * 0.38, h * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w * 0.75, h * 0.26);
    ctx.lineTo(w * 0.8, h * 0.06);
    ctx.lineTo(w * 0.62, h * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tail
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(6, w * 0.07);
    ctx.beginPath();
    ctx.moveTo(w * 0.72, h * 0.78);
    ctx.quadraticCurveTo(w * 0.96, h * 0.64, w * 0.84, h * 0.44);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, w * 0.025);
    ctx.strokeStyle = stroke;

    // Body
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.66, w * 0.25, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.3, w * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eyes & Nose
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.29, w * 0.035, 0, Math.PI * 2);
    ctx.arc(w * 0.58, h * 0.29, w * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.35, w * 0.03, 0, Math.PI * 2);
    ctx.fill();
  } else if (characterId === 'heroi') {
    // Cape
    ctx.fillStyle = accent;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(w * 0.28, h * 0.42);
    ctx.lineTo(w * 0.1, h * 0.88);
    ctx.lineTo(w * 0.9, h * 0.88);
    ctx.lineTo(w * 0.72, h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Torso
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.3, h * 0.4, w * 0.4, h * 0.34, 14);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.23, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Mask visor
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(w * 0.35, h * 0.17, w * 0.3, h * 0.08, 6);
    ctx.fill();

    // Legs
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(w * 0.33, h * 0.73, w * 0.14, h * 0.22, 6);
    ctx.roundRect(w * 0.53, h * 0.73, w * 0.14, h * 0.22, 6);
    ctx.fill();
    ctx.stroke();
  } else if (characterId === 'foguete') {
    // Flame
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(w * 0.38, h * 0.76);
    ctx.lineTo(w * 0.5, h * 0.98);
    ctx.lineTo(w * 0.62, h * 0.76);
    ctx.closePath();
    ctx.fill();

    // Fins
    ctx.fillStyle = accent;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(w * 0.32, h * 0.56);
    ctx.lineTo(w * 0.14, h * 0.78);
    ctx.lineTo(w * 0.34, h * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w * 0.68, h * 0.56);
    ctx.lineTo(w * 0.86, h * 0.78);
    ctx.lineTo(w * 0.66, h * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fuselage
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.04);
    ctx.quadraticCurveTo(w * 0.76, h * 0.34, w * 0.66, h * 0.76);
    ctx.lineTo(w * 0.34, h * 0.76);
    ctx.quadraticCurveTo(w * 0.24, h * 0.34, w * 0.5, h * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Window
    ctx.fillStyle = '#06B6D4';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.4, w * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // Carro
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.roundRect(w * 0.08, h * 0.45, w * 0.84, h * 0.28, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(w * 0.22, h * 0.45);
    ctx.lineTo(w * 0.35, h * 0.22);
    ctx.lineTo(w * 0.68, h * 0.22);
    ctx.lineTo(w * 0.78, h * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Wheels
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(w * 0.27, h * 0.75, w * 0.11, 0, Math.PI * 2);
    ctx.arc(w * 0.73, h * 0.75, w * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(w * 0.27, h * 0.75, w * 0.045, 0, Math.PI * 2);
    ctx.arc(w * 0.73, h * 0.75, w * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawShapeVector(
  ctx: CanvasRenderingContext2D,
  shapeId: ShapePresetId,
  w: number,
  h: number,
  fill: string,
  stroke: string
): void {
  ctx.save();
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  if (shapeId === 'rect') {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 14);
    ctx.fill();
    ctx.stroke();
  } else if (shapeId === 'circle') {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shapeId === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (shapeId === 'star') {
    const spikes = 5;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * 0.45;
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (shapeId === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(0, h * 0.3);
    ctx.lineTo(w * 0.62, h * 0.3);
    ctx.lineTo(w * 0.62, 0);
    ctx.lineTo(w, h * 0.5);
    ctx.lineTo(w * 0.62, h);
    ctx.lineTo(w * 0.62, h * 0.7);
    ctx.lineTo(0, h * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // bubble
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h * 0.8, 18);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.78);
    ctx.lineTo(w * 0.16, h);
    ctx.lineTo(w * 0.42, h * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  config: TextLayerConfig,
  progress: number // 0..1 animation progress
): void {
  ctx.save();
  let textToDraw = config.text;
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1;
  let rot = 0;

  if (config.animation === 'typewriter') {
    const count = Math.max(1, Math.round(config.text.length * Math.min(1, progress * 1.15)));
    textToDraw = config.text.slice(0, count);
  } else if (config.animation === 'slide-up') {
    const p = Math.min(1, progress * 1.4);
    offsetY = (1 - applyEasing(p, 'ease-out')) * 44;
    ctx.globalAlpha *= p;
  } else if (config.animation === 'bounce') {
    offsetY = -Math.abs(Math.sin(progress * Math.PI * 3)) * 22;
  } else if (config.animation === 'pulse') {
    scale = 1 + Math.sin(progress * Math.PI * 4) * 0.1;
  } else if (config.animation === 'wave') {
    offsetY = Math.sin(progress * Math.PI * 2) * 14;
    rot = Math.cos(progress * Math.PI * 2) * 0.05;
  } else if (config.animation === 'zoom-in') {
    const p = Math.min(1, progress * 1.4);
    scale = 0.3 + applyEasing(p, 'ease-out') * 0.7;
    ctx.globalAlpha *= p;
  } else if (config.animation === 'spin') {
    rot = progress * Math.PI * 2;
  }

  ctx.translate(offsetX, offsetY);
  ctx.rotate(rot);
  ctx.scale(scale, scale);

  ctx.font = `${config.fontWeight} ${config.fontSize}px "${config.fontFamily}", sans-serif`;
  ctx.textAlign = config.align;
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(textToDraw || ' ');
  const textW = metrics.width;
  const textH = config.fontSize * 1.2;

  if (config.backgroundColor && config.backgroundColor !== 'transparent') {
    const pad = config.backgroundPadding || 12;
    let boxX = -textW / 2 - pad;
    if (config.align === 'left') boxX = -pad;
    if (config.align === 'right') boxX = -textW - pad;
    ctx.fillStyle = config.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(boxX, -textH / 2 - pad / 2, textW + pad * 2, textH + pad, 10);
    ctx.fill();
  }

  if (config.shadowBlur > 0) {
    ctx.shadowBlur = config.shadowBlur;
    ctx.shadowColor = config.shadowColor;
  }

  if (config.strokeWidth > 0) {
    ctx.strokeStyle = config.strokeColor;
    ctx.lineWidth = config.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeText(textToDraw, 0, 0);
  }

  ctx.fillStyle = config.color;
  ctx.fillText(textToDraw, 0, 0);
  ctx.restore();
}

export function drawParticlesOverlay(
  ctx: CanvasRenderingContext2D,
  preset: ParticlePreset,
  width: number,
  height: number,
  frameIndex: number
): void {
  if (preset === 'none') return;
  ctx.save();
  const count = preset === 'rain' ? 70 : 48;
  for (let i = 0; i < count; i++) {
    const seedX = ((i * 197 + 31) % 1000) / 1000;
    const seedY = ((i * 353 + 79) % 1000) / 1000;
    const speed = 0.04 + (i % 5) * 0.015;
    const x = ((seedX + (preset === 'snow' ? Math.sin(frameIndex * 0.25 + i) * 0.03 : 0)) % 1) * width;
    const y = ((seedY + frameIndex * speed) % 1) * height;

    if (preset === 'rain') {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 18);
      ctx.stroke();
    } else if (preset === 'snow') {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
    } else if (preset === 'sparks') {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(245, 158, 11, 0.85)' : 'rgba(251, 146, 60, 0.8)';
      ctx.beginPath();
      ctx.arc(x, height - y, 2.5 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    } else if (preset === 'confetti') {
      const colors = ['#F59E0B', '#06B6D4', '#EC4899', '#10B981', '#F8FAFC'];
      ctx.fillStyle = colors[i % colors.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(frameIndex * 0.3 + i);
      ctx.fillRect(-5, -3, 10, 6);
      ctx.restore();
    }
  }
  ctx.restore();
}

export const STUDIO_BACKGROUND_IMAGE_URL = '/assets/aistudio/aab_1__332f17d6.png';

let studioBgImage: HTMLImageElement | null = null;
let studioBgPromise: Promise<HTMLImageElement | null> | null = null;

export function getStudioBackgroundImage(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!studioBgImage) {
    studioBgImage = new Image();
    studioBgImage.src = STUDIO_BACKGROUND_IMAGE_URL;
  }
  return studioBgImage;
}

export function ensureStudioBackgroundLoaded(): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  const img = getStudioBackgroundImage();
  if (!img) return Promise.resolve(null);
  if (img.complete && img.naturalWidth > 0) return Promise.resolve(img);
  if (!studioBgPromise) {
    studioBgPromise = new Promise((resolve) => {
      const done = () => resolve(img.naturalWidth > 0 ? img : null);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', () => resolve(null), { once: true });
    });
  }
  return studioBgPromise;
}

export function drawStudioBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fallbackColor = '#111521'
): void {
  ctx.fillStyle = fallbackColor;
  ctx.fillRect(0, 0, width, height);

  const bg = getStudioBackgroundImage();
  if (bg && bg.complete && bg.naturalWidth > 0) {
    const scale = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
    const dw = bg.naturalWidth * scale;
    const dh = bg.naturalHeight * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.drawImage(bg, dx, dy, dw, dh);
  }
}

export function renderAnimationFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  project: StudioProject,
  frameIndex: number,
  imageCache: Map<string, HTMLImageElement>,
  options?: {
    onionSkin?: boolean;
    onionOpacity?: number;
    selectedLayerId?: string | null;
    showGrid?: boolean;
    gifCache?: Map<string, DecodedGif>;
    videoCache?: Map<string, HTMLVideoElement>;
    elapsedMs?: number;
  }
): void {
  const { width, height, frames, layers } = project;
  const safeIndex = Math.max(0, Math.min(frames.length - 1, frameIndex));
  const frame: AnimationFrame | undefined = frames[safeIndex];

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawStudioBackground(ctx, width, height, frame?.backgroundColor || '#111521');

  if (options?.showGrid) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const step = 64;
    for (let gx = step; gx < width; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (let gy = step; gy < height; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }
  }

  const drawSinglePass = (idx: number, ghostAlpha: number | null) => {
    const targetFrame = frames[idx];
    if (!targetFrame) return;
    const frameTimeMs =
      options?.elapsedMs ??
      frames.slice(0, idx).reduce((acc, f) => acc + (f.durationMs || 42), 0);

    layers.forEach((layer) => {
      if (!layer.visible) return;
      const tr = interpolateLayerAtFrame(layer, idx, frames.length);

      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.rotate((tr.rotation * Math.PI) / 180);
      ctx.scale(tr.scaleX, tr.scaleY);
      ctx.globalAlpha = ghostAlpha !== null ? ghostAlpha * tr.opacity : tr.opacity;
      if (ghostAlpha === null) {
        ctx.filter = buildCssFilterString(layer.effects || DEFAULT_EFFECTS);
      }

      if (layer.kind === 'character' && layer.characterId) {
        drawCharacterVector(
          ctx,
          layer.characterId,
          layer.width,
          layer.height,
          layer.fillColor,
          layer.strokeColor,
          layer.accentColor
        );
      } else if (layer.kind === 'object' && layer.shapeId) {
        drawShapeVector(
          ctx,
          layer.shapeId,
          layer.width,
          layer.height,
          layer.fillColor,
          layer.strokeColor
        );
      } else if (layer.kind === 'image' && layer.mediaId) {
        const decodedGif = options?.gifCache?.get(layer.mediaId);
        const gifFrame = decodedGif ? pickGifFrameAtTime(decodedGif, frameTimeMs) : null;
        const img = imageCache.get(layer.mediaId);
        const sourceDrawable: CanvasImageSource | null =
          gifFrame || (img && img.complete && img.naturalWidth > 0 ? img : null);

        if (sourceDrawable) {
          if (layer.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(layer.width));
            off.height = Math.max(1, Math.round(layer.height));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(sourceDrawable, 0, 0, off.width, off.height);
              const imgData = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(imgData, layer.chromaKey || DEFAULT_CHROMA_KEY);
              octx.putImageData(imgData, 0, 0);
              ctx.drawImage(off, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
            }
          } else {
            ctx.drawImage(
              sourceDrawable,
              -layer.width / 2,
              -layer.height / 2,
              layer.width,
              layer.height
            );
          }
        } else {
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        }
      } else if (layer.kind === 'video' && layer.mediaId) {
        const video = options?.videoCache?.get(layer.mediaId);
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          if (layer.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(layer.width));
            off.height = Math.max(1, Math.round(layer.height));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(video, 0, 0, off.width, off.height);
              const imgData = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(imgData, layer.chromaKey || DEFAULT_CHROMA_KEY);
              octx.putImageData(imgData, 0, 0);
              ctx.drawImage(off, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
            }
          } else {
            ctx.drawImage(video, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
          }
        } else {
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        }
      } else if (layer.kind === 'text' && layer.textConfig) {
        const progress = frames.length > 1 ? idx / (frames.length - 1) : 1;
        drawTextLayer(ctx, layer.textConfig, progress);
      }

      ctx.restore();
    });

    // Freehand brush strokes on that frame
    targetFrame.strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.save();
      ctx.globalAlpha = ghostAlpha !== null ? ghostAlpha * stroke.opacity : stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    });
  };

  // Onion skinning (previous frame)
  if (options?.onionSkin && safeIndex > 0) {
    drawSinglePass(safeIndex - 1, options.onionOpacity ?? 0.25);
  }

  // Active frame
  drawSinglePass(safeIndex, null);

  // Particles
  drawParticlesOverlay(ctx, project.particles || 'none', width, height, safeIndex);

  // Selection gizmo (uniform handle sizes regardless of layer scale)
  if (options?.selectedLayerId) {
    const sel = layers.find((l) => l.id === options.selectedLayerId);
    if (sel && sel.visible) {
      const tr = interpolateLayerAtFrame(sel, safeIndex, frames.length);
      const halfW = (sel.width * Math.abs(tr.scaleX)) / 2 + 12;
      const halfH = (sel.height * Math.abs(tr.scaleY)) / 2 + 12;

      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.rotate((tr.rotation * Math.PI) / 180);

      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
      ctx.setLineDash([]);

      // 4 Corner resize handles
      const corners = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillStyle = '#0B0D11';
        ctx.fillRect(cx - 12, cy - 12, 24, 24);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(cx - 9, cy - 9, 18, 18);
      });

      // Rotation handle stem + knob
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -halfH);
      ctx.lineTo(0, -halfH - 44);
      ctx.stroke();

      ctx.fillStyle = '#0B0D11';
      ctx.beginPath();
      ctx.arc(0, -halfH - 46, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#06B6D4';
      ctx.beginPath();
      ctx.arc(0, -halfH - 46, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  ctx.restore();
}

export function generateProjectThumbnail(
  project: StudioProject,
  imageCache: Map<string, HTMLImageElement>
): string {
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 320;
  thumbCanvas.height = Math.max(180, Math.round((320 * project.height) / project.width));
  const ctx = thumbCanvas.getContext('2d');
  if (!ctx) return '';

  const off = document.createElement('canvas');
  off.width = project.width;
  off.height = project.height;
  const octx = off.getContext('2d');
  if (!octx) return '';

  renderAnimationFrameToCanvas(octx, project, 0, imageCache);
  ctx.drawImage(off, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas.toDataURL('image/jpeg', 0.78);
}
