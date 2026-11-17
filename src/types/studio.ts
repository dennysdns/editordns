export type StudioView =
  | 'home'
  | 'files'
  | 'animation'
  | 'video'
  | 'audio'
  | 'chroma'
  | 'bg-remover'
  | 'effects'
  | 'text'
  | 'gallery'
  | 'projects'
  | 'export'
  | 'settings';

export type VirtualFolderId =
  | 'internal'
  | 'sdcard'
  | 'downloads'
  | 'music'
  | 'videos'
  | 'images'
  | 'documents'
  | 'custom';

export interface CustomFolder {
  id: string;
  name: string;
  createdAt: number;
}

export type MediaKind = 'audio' | 'video' | 'image';

export interface MediaFile {
  id: string;
  name: string;
  extension: string;
  kind: MediaKind;
  mimeType: string;
  size: number;
  folder: VirtualFolderId;
  customFolderId?: string;
  duration?: number;
  width?: number;
  height?: number;
  blob: Blob;
  thumbnailDataUrl?: string;
  supported: boolean;
  supportNote?: string;
  createdAt: number;
}

export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export type MotionPreset = 'none' | 'bounce' | 'float' | 'orbit' | 'shake' | 'pulse';

export interface LayerKeyframe {
  frameIndex: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  easing: EasingType;
}

export interface EffectsConfig {
  brightness: number; // 0 to 200 (100 default)
  contrast: number; // 0 to 200 (100 default)
  saturation: number; // 0 to 200 (100 default)
  blur: number; // 0 to 20px
  hueRotate: number; // -180 to 180 deg
  sepia: number; // 0 to 100
  grayscale: number; // 0 to 100
  pixelate: number; // 1 to 32 (1 = off)
  glitch: number; // 0 to 100
  vignette: number; // 0 to 100
  grain: number; // 0 to 100
}

export interface ChromaKeyConfig {
  enabled: boolean;
  keyColor: string; // hex e.g. '#00FF00'
  similarity: number; // 0 to 100
  smoothness: number; // 0 to 100
  spill: number; // 0 to 100
}

export type TextAnimationPreset =
  | 'none'
  | 'typewriter'
  | 'slide-up'
  | 'bounce'
  | 'pulse'
  | 'wave'
  | 'zoom-in'
  | 'spin';

export interface TextLayerConfig {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '600' | '700' | '800';
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadowBlur: number;
  shadowColor: string;
  backgroundColor: string;
  backgroundPadding: number;
  animation: TextAnimationPreset;
  align: 'left' | 'center' | 'right';
}

export type CharacterPresetId =
  | 'robo'
  | 'astronauta'
  | 'gato'
  | 'heroi'
  | 'foguete'
  | 'carro';

export type ShapePresetId =
  | 'rect'
  | 'circle'
  | 'star'
  | 'triangle'
  | 'arrow'
  | 'bubble';

export type AnimationLayerKind = 'character' | 'object' | 'image' | 'video' | 'text';

export interface AnimationLayer {
  id: string;
  name: string;
  kind: AnimationLayerKind;
  visible: boolean;
  locked: boolean;
  characterId?: CharacterPresetId;
  shapeId?: ShapePresetId;
  mediaId?: string;
  fillColor: string;
  strokeColor: string;
  accentColor: string;
  width: number;
  height: number;
  motionPreset: MotionPreset;
  motionIntensity: number;
  textConfig?: TextLayerConfig;
  effects: EffectsConfig;
  chromaKey: ChromaKeyConfig;
  keyframes: LayerKeyframe[];
}

export interface BrushStroke {
  id: string;
  color: string;
  size: number;
  opacity: number;
  points: { x: number; y: number }[];
}

export interface AnimationFrame {
  id: string;
  label: string;
  durationMs: number;
  backgroundColor: string;
  strokes: BrushStroke[];
}

export type ParticlePreset = 'none' | 'rain' | 'snow' | 'sparks' | 'confetti';

export interface VideoClip {
  id: string;
  track: 'video' | 'overlay';
  mediaId?: string;
  name: string;
  kind: 'video' | 'image' | 'text' | 'color';
  startTime: number; // seconds
  duration: number; // seconds
  trimStart: number; // seconds inside source
  speed: number; // 0.25 to 4
  volume: number; // 0 to 1
  x: number; // normalized offset -0.5 to 0.5 or px
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  transition: 'none' | 'fade-in' | 'fade-out' | 'fade-both';
  backgroundColor?: string;
  textConfig?: TextLayerConfig;
  effects: EffectsConfig;
  chromaKey: ChromaKeyConfig;
}

export interface AudioClip {
  id: string;
  mediaId: string;
  name: string;
  startTime: number; // timeline position in seconds
  duration: number; // active trimmed duration in seconds
  sourceDuration: number;
  trimStart: number; // seconds from start of source
  gain: number; // 0 to 2
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  speed: number; // 0.5 to 2
  eqBass: number; // -12 to +12 dB
  eqMid: number; // -12 to +12 dB
  eqTreble: number; // -12 to +12 dB
  muted: boolean;
  solo: boolean;
  peaks: number[]; // normalized 0..1 waveform bars
}

export interface StudioProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  lastTool: StudioView;
  thumbnailDataUrl?: string;
  createdAt: number;
  updatedAt: number;
  frames: AnimationFrame[];
  layers: AnimationLayer[];
  particles: ParticlePreset;
  videoClips: VideoClip[];
  audioClips: AudioClip[];
}

export interface GalleryItem {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  blob: Blob;
  thumbnailDataUrl?: string;
  createdAt: number;
}

export interface StudioSettings {
  defaultWidth: number;
  defaultHeight: number;
  defaultFps: number;
  onionSkinOpacity: number;
  autoSaveIntervalSec: number;
  audioSampleRate: 44100 | 48000;
  gridVisible: boolean;
  snapToGrid: boolean;
}

export const DEFAULT_EFFECTS: EffectsConfig = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  hueRotate: 0,
  sepia: 0,
  grayscale: 0,
  pixelate: 1,
  glitch: 0,
  vignette: 0,
  grain: 0,
};

export const DEFAULT_CHROMA_KEY: ChromaKeyConfig = {
  enabled: false,
  keyColor: '#00FF00',
  similarity: 35,
  smoothness: 12,
  spill: 25,
};

export const DEFAULT_SETTINGS: StudioSettings = {
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultFps: 24,
  onionSkinOpacity: 0.28,
  autoSaveIntervalSec: 15,
  audioSampleRate: 44100,
  gridVisible: true,
  snapToGrid: true,
};
