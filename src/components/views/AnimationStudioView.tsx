import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Repeat,
  Plus,
  Copy,
  Trash2,
  Layers,
  User,
  Shapes,
  Image as ImageIcon,
  Type,
  PenTool,
  MousePointer,
  Eye,
  EyeOff,
  Sparkles,
  Diamond,
  Save,
  Grid,
  Upload,
  Film,
  Pipette,
  Lock,
  Unlock,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Clock,
} from 'lucide-react';
import {
  AnimationFrame,
  AnimationLayer,
  CharacterPresetId,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  EasingType,
  MediaFile,
  MotionPreset,
  ParticlePreset,
  ShapePresetId,
  StudioProject,
  StudioSettings,
} from '../../types/studio';
import {
  ensureStudioBackgroundLoaded,
  interpolateLayerAtFrame,
  renderAnimationFrameToCanvas,
  STUDIO_BACKGROUND_IMAGE_URL,
} from '../../utils/canvasRenderer';
import { ALL_ACCEPTED_EXTENSIONS, processImportedFile } from '../../utils/mediaImporter';
import { DecodedGif } from '../../utils/gifDecoder';

interface AnimationStudioViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  imageCache: Map<string, HTMLImageElement>;
  gifCache: Map<string, DecodedGif>;
  videoCache: Map<string, HTMLVideoElement>;
  settings: StudioSettings;
  onUpdateProject: (updated: StudioProject) => void;
  onSaveProject: () => Promise<void>;
  onImportMedia: (files: MediaFile[]) => Promise<void>;
}

const CHARACTER_OPTIONS: { id: CharacterPresetId; label: string }[] = [
  { id: 'astronauta', label: 'Astronauta' },
  { id: 'robo', label: 'Robô' },
  { id: 'gato', label: 'Gato' },
  { id: 'heroi', label: 'Herói' },
  { id: 'foguete', label: 'Foguete' },
  { id: 'carro', label: 'Carro' },
];

const SHAPE_OPTIONS: { id: ShapePresetId; label: string }[] = [
  { id: 'rect', label: 'Retângulo' },
  { id: 'circle', label: 'Círculo' },
  { id: 'star', label: 'Estrela' },
  { id: 'triangle', label: 'Triângulo' },
  { id: 'arrow', label: 'Seta' },
  { id: 'bubble', label: 'Balão' },
];

export const AnimationStudioView: React.FC<AnimationStudioViewProps> = ({
  project,
  mediaFiles,
  imageCache,
  gifCache,
  videoCache,
  settings,
  onUpdateProject,
  onSaveProject,
  onImportMedia,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [onionSkin, setOnionSkin] = useState(true);
  const [showGrid, setShowGrid] = useState(settings.gridVisible);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    project.layers[0]?.id || null
  );
  const [toolMode, setToolMode] = useState<'select' | 'brush' | 'eyedropper'>('select');
  const [brushColor, setBrushColor] = useState('#F59E0B');
  const [brushSize, setBrushSize] = useState(6);
  const [proportionalResize, setProportionalResize] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(72);
  const [activeAddTab, setActiveAddTab] = useState<'chars' | 'shapes' | 'images' | 'fx'>('chars');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Drag state (move, draw, corner resize, top knob rotate)
  const dragStateRef = useRef<{
    active: boolean;
    mode: 'move' | 'draw' | 'resize' | 'rotate';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origScaleX: number;
    origScaleY: number;
    origDist: number;
    origLocalX: number;
    origLocalY: number;
    origRotation: number;
    startAngle: number;
    strokeId?: string;
  }>({
    active: false,
    mode: 'move',
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origScaleX: 1,
    origScaleY: 1,
    origDist: 100,
    origLocalX: 100,
    origLocalY: 100,
    origRotation: 0,
    startAngle: 0,
  });

  const safeFrameIndex = Math.max(0, Math.min(project.frames.length - 1, currentFrame));
  const activeFrame = project.frames[safeFrameIndex];
  const selectedLayer = project.layers.find((l) => l.id === selectedLayerId) || null;
  const selectedTransform = selectedLayer
    ? interpolateLayerAtFrame(selectedLayer, safeFrameIndex, project.frames.length)
    : null;

  const [playTick, setPlayTick] = useState(0);
  const playbackOriginRef = useRef<number>(0);

  useEffect(() => {
    void ensureStudioBackgroundLoaded().then((img) => {
      if (img) setPlayTick((t) => (t + 1) % 1_000_000);
    });
  }, []);

  // Playback loop respecting frame duration & speed multiplier + live GIF/MP4 sync
  useEffect(() => {
    if (!isPlaying) return;
    const frameDur = activeFrame?.durationMs || Math.round(1000 / project.fps);
    const delay = Math.max(16, Math.round(frameDur / speedMultiplier));
    const timer = window.setTimeout(() => {
      setCurrentFrame((prev) => {
        if (prev + 1 < project.frames.length) return prev + 1;
        if (loop) return 0;
        setIsPlaying(false);
        return prev;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isPlaying, safeFrameIndex, project.frames.length, project.fps, activeFrame?.durationMs, speedMultiplier, loop]);

  // Smooth RAF repaint and MP4 playback sync when playing or seeking frames
  useEffect(() => {
    const videoLayers = project.layers.filter((l) => l.kind === 'video' && l.visible && l.mediaId);
    const frameElapsedMs = project.frames
      .slice(0, safeFrameIndex)
      .reduce((acc, f) => acc + (f.durationMs || 42), 0);

    if (isPlaying) {
      if (playbackOriginRef.current === 0) {
        playbackOriginRef.current = performance.now() - frameElapsedMs / speedMultiplier;
      }

      videoLayers.forEach((l) => {
        const vel = l.mediaId ? videoCache.get(l.mediaId) : undefined;
        if (vel) {
          vel.playbackRate = Math.max(0.25, Math.min(4, speedMultiplier));
          vel.loop = loop;
          if (vel.paused) {
            void vel.play().catch(() => {
              vel.muted = true;
              void vel.play().catch(() => {});
            });
          }
        }
      });

      let raf = 0;
      const tick = () => {
        setPlayTick((t) => (t + 1) % 1_000_000);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    } else {
      playbackOriginRef.current = 0;
      videoCache.forEach((vel) => {
        if (!vel.paused) vel.pause();
      });
      videoLayers.forEach((l) => {
        const vel = l.mediaId ? videoCache.get(l.mediaId) : undefined;
        if (vel && vel.readyState >= 1 && vel.duration && Number.isFinite(vel.duration)) {
          const targetTime = (frameElapsedMs / 1000) % vel.duration;
          if (Math.abs(vel.currentTime - targetTime) > 0.03) {
            vel.onseeked = () => setPlayTick((t) => (t + 1) % 1_000_000);
            vel.currentTime = targetTime;
          }
        }
      });
    }
  }, [isPlaying, safeFrameIndex, project.layers, project.frames, speedMultiplier, loop, videoCache]);

  // Render stage canvas whenever state or live GIF/MP4 tick changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frameElapsedMs = project.frames
      .slice(0, safeFrameIndex)
      .reduce((acc, f) => acc + (f.durationMs || 42), 0);
    const liveElapsedMs =
      isPlaying && playbackOriginRef.current > 0
        ? (performance.now() - playbackOriginRef.current) * speedMultiplier
        : frameElapsedMs;

    renderAnimationFrameToCanvas(ctx, project, safeFrameIndex, imageCache, {
      onionSkin: !isPlaying && onionSkin,
      onionOpacity: settings.onionSkinOpacity,
      selectedLayerId: !isPlaying && toolMode === 'select' ? selectedLayerId : null,
      showGrid: !isPlaying && showGrid,
      gifCache,
      videoCache,
      elapsedMs: liveElapsedMs,
    });
  }, [
    project,
    safeFrameIndex,
    imageCache,
    gifCache,
    videoCache,
    playTick,
    isPlaying,
    speedMultiplier,
    onionSkin,
    settings.onionSkinOpacity,
    selectedLayerId,
    toolMode,
    showGrid,
  ]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = project.width / Math.max(1, rect.width);
    const scaleY = project.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const upsertLayerKeyframe = (
    layer: AnimationLayer,
    frameIdx: number,
    patch: Partial<{
      x: number;
      y: number;
      scaleX: number;
      scaleY: number;
      rotation: number;
      opacity: number;
      easing: EasingType;
    }>
  ): AnimationLayer => {
    const resolved = interpolateLayerAtFrame(layer, frameIdx, project.frames.length);
    const existingIdx = layer.keyframes.findIndex((k) => k.frameIndex === frameIdx);
    const nextKf = {
      frameIndex: frameIdx,
      x: patch.x ?? resolved.x,
      y: patch.y ?? resolved.y,
      scaleX: patch.scaleX ?? resolved.scaleX,
      scaleY: patch.scaleY ?? resolved.scaleY,
      rotation: patch.rotation ?? resolved.rotation,
      opacity: patch.opacity ?? resolved.opacity,
      easing:
        patch.easing ??
        (existingIdx >= 0 ? layer.keyframes[existingIdx].easing : 'ease-in-out'),
    };
    const keyframes =
      existingIdx >= 0
        ? layer.keyframes.map((k, idx) => (idx === existingIdx ? nextKf : k))
        : [...layer.keyframes, nextKf].sort((a, b) => a.frameIndex - b.frameIndex);

    return { ...layer, keyframes };
  };

  const updateSelectedLayer = (
    updater: (layer: AnimationLayer) => AnimationLayer
  ) => {
    if (!selectedLayerId) return;
    onUpdateProject({
      ...project,
      lastTool: 'animation',
      layers: project.layers.map((l) => (l.id === selectedLayerId ? updater(l) : l)),
    });
  };

  const toLayerSpace = (
    pt: { x: number; y: number },
    tr: { x: number; y: number; rotation: number }
  ) => {
    const dx = pt.x - tr.x;
    const dy = pt.y - tr.y;
    const rad = (-tr.rotation * Math.PI) / 180;
    return {
      rx: dx * Math.cos(rad) - dy * Math.sin(rad),
      ry: dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  };

  const sampleStageColorForLayer = (
    pt: { x: number; y: number },
    layer: AnimationLayer
  ): string | null => {
    const tr = interpolateLayerAtFrame(layer, safeFrameIndex, project.frames.length);
    const { rx, ry } = toLayerSpace(pt, tr);
    const sx = Math.abs(tr.scaleX) < 0.05 ? 0.05 : tr.scaleX;
    const sy = Math.abs(tr.scaleY) < 0.05 ? 0.05 : tr.scaleY;
    const localX = rx / sx + layer.width / 2;
    const localY = ry / sy + layer.height / 2;

    if (
      layer.mediaId &&
      localX >= 0 &&
      localX <= layer.width &&
      localY >= 0 &&
      localY <= layer.height
    ) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(layer.width));
      off.height = Math.max(1, Math.round(layer.height));
      const octx = off.getContext('2d');
      if (octx) {
        if (layer.kind === 'image') {
          const decoded = gifCache.get(layer.mediaId);
          const img = imageCache.get(layer.mediaId);
          const src = (decoded?.frames[0]?.canvas || img) as CanvasImageSource | undefined;
          if (src) octx.drawImage(src, 0, 0, off.width, off.height);
        } else if (layer.kind === 'video') {
          const vel = videoCache.get(layer.mediaId);
          if (vel && vel.readyState >= 2) octx.drawImage(vel, 0, 0, off.width, off.height);
        }
        const px = Math.max(0, Math.min(off.width - 1, Math.floor(localX)));
        const py = Math.max(0, Math.min(off.height - 1, Math.floor(localY)));
        const data = octx.getImageData(px, py, 1, 1).data;
        if (data[3] > 0) {
          return `#${[data[0], data[1], data[2]]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')}`;
        }
      }
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const cx = Math.max(0, Math.min(canvas.width - 1, Math.round(pt.x)));
      const cy = Math.max(0, Math.min(canvas.height - 1, Math.round(pt.y)));
      const data = ctx.getImageData(cx, cy, 1, 1).data;
      return `#${[data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`;
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPlaying) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);

    if (toolMode === 'eyedropper' && selectedLayer) {
      const sampled = sampleStageColorForLayer(pt, selectedLayer);
      if (sampled) {
        updateSelectedLayer((l) => ({
          ...l,
          chromaKey: {
            ...(l.chromaKey || DEFAULT_CHROMA_KEY),
            enabled: true,
            keyColor: sampled,
          },
        }));
      }
      setToolMode('select');
      return;
    }

    if (toolMode === 'brush') {
      const strokeId = `stroke-${Date.now()}`;
      const newFrames = project.frames.map((f, idx) =>
        idx === safeFrameIndex
          ? {
              ...f,
              strokes: [
                ...f.strokes,
                {
                  id: strokeId,
                  color: brushColor,
                  size: brushSize,
                  opacity: 1,
                  points: [pt],
                },
              ],
            }
          : f
      );
      onUpdateProject({ ...project, frames: newFrames });
      dragStateRef.current = {
        ...dragStateRef.current,
        active: true,
        mode: 'draw',
        startX: pt.x,
        startY: pt.y,
        strokeId,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // 1) Check interactive resize/rotate handles on currently selected layer first
    if (selectedLayer && selectedLayer.visible && !selectedLayer.locked) {
      const tr = interpolateLayerAtFrame(selectedLayer, safeFrameIndex, project.frames.length);
      const halfW = (selectedLayer.width * Math.abs(tr.scaleX)) / 2 + 12;
      const halfH = (selectedLayer.height * Math.abs(tr.scaleY)) / 2 + 12;
      const { rx, ry } = toLayerSpace(pt, tr);

      // Rotation handle at (0, -halfH - 46)
      if (Math.hypot(rx, ry - (-halfH - 46)) <= 42) {
        dragStateRef.current = {
          ...dragStateRef.current,
          active: true,
          mode: 'rotate',
          startX: pt.x,
          startY: pt.y,
          origX: tr.x,
          origY: tr.y,
          origRotation: tr.rotation,
          startAngle: Math.atan2(pt.y - tr.y, pt.x - tr.x),
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      // 4 Corner resize handles
      const corners = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
      ];
      const hitCorner = corners.some(([cx, cy]) => Math.hypot(rx - cx, ry - cy) <= 44);
      if (hitCorner) {
        dragStateRef.current = {
          ...dragStateRef.current,
          active: true,
          mode: 'resize',
          startX: pt.x,
          startY: pt.y,
          origX: tr.x,
          origY: tr.y,
          origScaleX: tr.scaleX,
          origScaleY: tr.scaleY,
          origDist: Math.max(20, Math.hypot(pt.x - tr.x, pt.y - tr.y)),
          origLocalX: Math.max(16, Math.abs(rx)),
          origLocalY: Math.max(16, Math.abs(ry)),
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }

    // 2) Hit test layers top-to-bottom in rotated local coordinates
    let hitLayer: AnimationLayer | null = null;
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const l = project.layers[i];
      if (!l.visible || l.locked) continue;
      const tr = interpolateLayerAtFrame(l, safeFrameIndex, project.frames.length);
      const { rx, ry } = toLayerSpace(pt, tr);
      const halfW = (l.width * Math.abs(tr.scaleX)) / 2 + 18;
      const halfH = (l.height * Math.abs(tr.scaleY)) / 2 + 18;
      if (Math.abs(rx) <= halfW && Math.abs(ry) <= halfH) {
        hitLayer = l;
        break;
      }
    }

    if (hitLayer) {
      setSelectedLayerId(hitLayer.id);
      const tr = interpolateLayerAtFrame(hitLayer, safeFrameIndex, project.frames.length);
      dragStateRef.current = {
        ...dragStateRef.current,
        active: true,
        mode: 'move',
        startX: pt.x,
        startY: pt.y,
        origX: tr.x,
        origY: tr.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      setSelectedLayerId(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStateRef.current.active) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);

    if (dragStateRef.current.mode === 'draw' && dragStateRef.current.strokeId) {
      const sid = dragStateRef.current.strokeId;
      onUpdateProject({
        ...project,
        frames: project.frames.map((f, idx) =>
          idx === safeFrameIndex
            ? {
                ...f,
                strokes: f.strokes.map((s) =>
                  s.id === sid ? { ...s, points: [...s.points, pt] } : s
                ),
              }
            : f
        ),
      });
      return;
    }

    if (!selectedLayer) return;

    if (dragStateRef.current.mode === 'resize') {
      if (proportionalResize) {
        const dist = Math.hypot(
          pt.x - dragStateRef.current.origX,
          pt.y - dragStateRef.current.origY
        );
        const factor = dist / Math.max(20, dragStateRef.current.origDist);
        const sx = Number(
          Math.max(0.1, Math.min(6, dragStateRef.current.origScaleX * factor)).toFixed(2)
        );
        const sy = Number(
          Math.max(0.1, Math.min(6, dragStateRef.current.origScaleY * factor)).toFixed(2)
        );
        updateSelectedLayer((layer) =>
          upsertLayerKeyframe(layer, safeFrameIndex, { scaleX: sx, scaleY: sy })
        );
      } else {
        const tr = interpolateLayerAtFrame(selectedLayer, safeFrameIndex, project.frames.length);
        const { rx, ry } = toLayerSpace(pt, tr);
        const fx = Math.abs(rx) / Math.max(16, dragStateRef.current.origLocalX);
        const fy = Math.abs(ry) / Math.max(16, dragStateRef.current.origLocalY);
        const sx = Number(
          Math.max(0.1, Math.min(6, dragStateRef.current.origScaleX * fx)).toFixed(2)
        );
        const sy = Number(
          Math.max(0.1, Math.min(6, dragStateRef.current.origScaleY * fy)).toFixed(2)
        );
        updateSelectedLayer((layer) =>
          upsertLayerKeyframe(layer, safeFrameIndex, { scaleX: sx, scaleY: sy })
        );
      }
      return;
    }

    if (dragStateRef.current.mode === 'rotate') {
      const angle = Math.atan2(
        pt.y - dragStateRef.current.origY,
        pt.x - dragStateRef.current.origX
      );
      const deltaDeg = ((angle - dragStateRef.current.startAngle) * 180) / Math.PI;
      const nextRot = Math.round(dragStateRef.current.origRotation + deltaDeg);
      updateSelectedLayer((layer) =>
        upsertLayerKeyframe(layer, safeFrameIndex, { rotation: nextRot })
      );
      return;
    }

    if (dragStateRef.current.mode === 'move') {
      const dx = pt.x - dragStateRef.current.startX;
      const dy = pt.y - dragStateRef.current.startY;
      let nx = Math.round(dragStateRef.current.origX + dx);
      let ny = Math.round(dragStateRef.current.origY + dy);
      if (settings.snapToGrid && showGrid) {
        nx = Math.round(nx / 16) * 16;
        ny = Math.round(ny / 16) * 16;
      }
      updateSelectedLayer((layer) =>
        upsertLayerKeyframe(layer, safeFrameIndex, { x: nx, y: ny })
      );
    }
  };

  const handlePointerUp = () => {
    dragStateRef.current.active = false;
  };

  const addCharacterLayer = (characterId: CharacterPresetId, label: string) => {
    const id = `layer-${Date.now()}`;
    const newLayer: AnimationLayer = {
      id,
      name: label,
      kind: 'character',
      characterId,
      visible: true,
      locked: false,
      fillColor: '#E2E8F0',
      strokeColor: '#0F172A',
      accentColor: '#F59E0B',
      width: 170,
      height: 190,
      motionPreset: 'none',
      motionIntensity: 16,
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: safeFrameIndex,
          x: Math.round(project.width / 2),
          y: Math.round(project.height / 2),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-in-out',
        },
      ],
    };
    onUpdateProject({ ...project, layers: [...project.layers, newLayer] });
    setSelectedLayerId(id);
    setToolMode('select');
  };

  const addShapeLayer = (shapeId: ShapePresetId, label: string) => {
    const id = `layer-${Date.now()}`;
    const newLayer: AnimationLayer = {
      id,
      name: label,
      kind: 'object',
      shapeId,
      visible: true,
      locked: false,
      fillColor: '#06B6D4',
      strokeColor: '#0F172A',
      accentColor: '#F59E0B',
      width: 150,
      height: 150,
      motionPreset: 'none',
      motionIntensity: 16,
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: safeFrameIndex,
          x: Math.round(project.width / 2),
          y: Math.round(project.height / 2),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-in-out',
        },
      ],
    };
    onUpdateProject({ ...project, layers: [...project.layers, newLayer] });
    setSelectedLayerId(id);
    setToolMode('select');
  };

  const addImageLayer = (mf: MediaFile) => {
    const id = `layer-${Date.now()}`;
    const aspect = mf.width && mf.height ? mf.width / mf.height : 1;
    const h = 240;
    const w = Math.round(h * aspect);
    const newLayer: AnimationLayer = {
      id,
      name: mf.name,
      kind: 'image',
      mediaId: mf.id,
      visible: true,
      locked: false,
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      accentColor: '#F59E0B',
      width: Math.min(project.width * 0.7, Math.max(80, w)),
      height: Math.min(project.height * 0.7, h),
      motionPreset: 'none',
      motionIntensity: 14,
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: safeFrameIndex,
          x: Math.round(project.width / 2),
          y: Math.round(project.height / 2),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-in-out',
        },
      ],
    };
    onUpdateProject({ ...project, layers: [...project.layers, newLayer] });
    setSelectedLayerId(id);
    setToolMode('select');
  };

  const addVideoLayer = (mf: MediaFile) => {
    const id = `layer-vid-${Date.now()}`;
    const aspect = mf.width && mf.height ? mf.width / mf.height : 9 / 16;
    const h = 420;
    const w = Math.round(h * aspect);
    const newLayer: AnimationLayer = {
      id,
      name: mf.name,
      kind: 'video',
      mediaId: mf.id,
      visible: true,
      locked: false,
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      accentColor: '#F59E0B',
      width: Math.min(project.width * 0.85, Math.max(120, w)),
      height: Math.min(project.height * 0.85, h),
      motionPreset: 'none',
      motionIntensity: 14,
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: safeFrameIndex,
          x: Math.round(project.width / 2),
          y: Math.round(project.height / 2),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-in-out',
        },
      ],
    };
    onUpdateProject({ ...project, layers: [...project.layers, newLayer] });
    setSelectedLayerId(id);
    setToolMode('select');
  };

  const addQuickTextLayer = () => {
    const id = `layer-${Date.now()}`;
    const newLayer: AnimationLayer = {
      id,
      name: 'Texto Animado',
      kind: 'text',
      visible: true,
      locked: false,
      fillColor: '#F8FAFC',
      strokeColor: '#0B0D11',
      accentColor: '#F59E0B',
      width: 440,
      height: 80,
      motionPreset: 'none',
      motionIntensity: 12,
      textConfig: {
        text: 'Cena Animada',
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 44,
        fontWeight: '700',
        color: '#F8FAFC',
        strokeColor: '#0B0D11',
        strokeWidth: 3,
        shadowBlur: 8,
        shadowColor: 'rgba(0,0,0,0.6)',
        backgroundColor: 'transparent',
        backgroundPadding: 10,
        animation: 'bounce',
        align: 'center',
      },
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: safeFrameIndex,
          x: Math.round(project.width / 2),
          y: Math.round(project.height * 0.22),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-out',
        },
      ],
    };
    onUpdateProject({ ...project, layers: [...project.layers, newLayer] });
    setSelectedLayerId(id);
  };

  const addFrame = () => {
    const newFrame: AnimationFrame = {
      id: `frame-${Date.now()}`,
      label: `Q${project.frames.length + 1}`,
      durationMs: activeFrame?.durationMs || Math.round(1000 / project.fps),
      backgroundColor: activeFrame?.backgroundColor || '#111521',
      strokes: [],
    };
    const nextFrames = [...project.frames];
    nextFrames.splice(safeFrameIndex + 1, 0, newFrame);
    onUpdateProject({ ...project, frames: nextFrames });
    setCurrentFrame(safeFrameIndex + 1);
  };

  const duplicateFrame = () => {
    if (!activeFrame) return;
    const copy: AnimationFrame = {
      ...activeFrame,
      id: `frame-${Date.now()}`,
      label: `${activeFrame.label}*`,
      strokes: activeFrame.strokes.map((s) => ({
        ...s,
        id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        points: [...s.points],
      })),
    };
    const nextFrames = [...project.frames];
    nextFrames.splice(safeFrameIndex + 1, 0, copy);
    onUpdateProject({ ...project, frames: nextFrames });
    setCurrentFrame(safeFrameIndex + 1);
  };

  const deleteFrame = () => {
    if (project.frames.length <= 1) return;
    const nextFrames = project.frames.filter((_, i) => i !== safeFrameIndex);
    onUpdateProject({ ...project, frames: nextFrames });
    setCurrentFrame(Math.max(0, safeFrameIndex - 1));
  };

  const clearFrameStrokes = () => {
    onUpdateProject({
      ...project,
      frames: project.frames.map((f, i) =>
        i === safeFrameIndex ? { ...f, strokes: [] } : f
      ),
    });
  };

  const handleDirectMediaUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imported: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const m = await processImportedFile(file, file.name, 'internal');
      if (m && (m.kind === 'image' || m.kind === 'video')) imported.push(m);
    }
    if (imported.length > 0) {
      await onImportMedia(imported);
      const first = imported[0];
      if (first.kind === 'video') addVideoLayer(first);
      else addImageLayer(first);
    }
  };

  const visualAssets = mediaFiles.filter((m) => m.kind === 'image' || m.kind === 'video');

  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-5 py-4 pb-24 lg:pb-6 space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          void handleDirectMediaUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Studio Top Control Bar */}
      <div className="rounded-xl bg-[#13161D] border border-white/8 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-white truncate max-w-[200px]">
            {project.name}
          </span>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            Quadro {safeFrameIndex + 1}/{project.frames.length} · {project.fps} FPS
          </span>
          <span
            className="rounded-lg bg-[#1A1E28] border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300 font-mono"
            title="Proporção Única do Projeto"
          >
            9:16 · {project.width}×{project.height}
          </span>
        </div>

        {/* Transport Controls: PLAY, PAUSE, STOP, VOLTAR, AVANÇAR, LOOP */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentFrame((p) => (p > 0 ? p - 1 : project.frames.length - 1));
            }}
            className="min-h-[40px] px-2.5 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-slate-200 text-xs inline-flex items-center gap-1 cursor-pointer"
            title="Voltar Quadro"
          >
            <SkipBack className="w-4 h-4" />
            <span className="hidden sm:inline">Voltar</span>
          </button>

          {!isPlaying ? (
            <button
              onClick={() => setIsPlaying(true)}
              className="min-h-[40px] px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              PLAY
            </button>
          ) : (
            <button
              onClick={() => setIsPlaying(false)}
              className="min-h-[40px] px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Pause className="w-4 h-4 fill-current" />
              PAUSE
            </button>
          )}

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentFrame(0);
            }}
            className="min-h-[40px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            STOP
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentFrame((p) => (p + 1) % project.frames.length);
            }}
            className="min-h-[40px] px-2.5 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-slate-200 text-xs inline-flex items-center gap-1 cursor-pointer"
            title="Avançar Quadro"
          >
            <span className="hidden sm:inline">Avançar</span>
            <SkipForward className="w-4 h-4" />
          </button>

          <button
            onClick={() => setLoop((v) => !v)}
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
              loop ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-[#1A1E28] text-slate-400'
            }`}
            title="Repetir Animação"
          >
            <Repeat className="w-3.5 h-3.5" />
            Loop
          </button>

          <select
            value={speedMultiplier}
            onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
            className="min-h-[40px] rounded-lg bg-[#1A1E28] border border-white/10 px-2 text-xs text-white font-mono"
            title="Velocidade de Reprodução"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              await onSaveProject();
              setSaveNotice('Salvo!');
              window.setTimeout(() => setSaveNotice(null), 2000);
            }}
            className="min-h-[40px] px-3.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saveNotice || 'Salvar'}
          </button>
        </div>
      </div>

      {/* Main 3-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-4 items-start">
        {/* Left Panel: Assets & Layers */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3.5 space-y-4">
          <div className="grid grid-cols-4 gap-1 bg-[#0B0D11] p-1 rounded-lg">
            {[
              { id: 'chars', label: 'Pers.', icon: User },
              { id: 'shapes', label: 'Obj.', icon: Shapes },
              { id: 'images', label: 'Img.', icon: ImageIcon },
              { id: 'fx', label: 'FX', icon: Sparkles },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveAddTab(t.id as typeof activeAddTab)}
                  className={`py-2 rounded-md text-[11px] font-medium flex flex-col items-center gap-1 cursor-pointer ${
                    activeAddTab === t.id
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {activeAddTab === 'chars' && (
            <div className="grid grid-cols-2 gap-2">
              {CHARACTER_OPTIONS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => addCharacterLayer(ch.id, ch.label)}
                  className="min-h-[42px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-2.5 py-2 text-xs font-medium text-slate-200 text-left cursor-pointer"
                >
                  + {ch.label}
                </button>
              ))}
              <button
                onClick={addQuickTextLayer}
                className="col-span-2 min-h-[42px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-2.5 py-2 text-xs font-medium text-amber-300 flex items-center gap-2 cursor-pointer"
              >
                <Type className="w-3.5 h-3.5" />+ Adicionar Texto Animado
              </button>
            </div>
          )}

          {activeAddTab === 'shapes' && (
            <div className="grid grid-cols-2 gap-2">
              {SHAPE_OPTIONS.map((sh) => (
                <button
                  key={sh.id}
                  onClick={() => addShapeLayer(sh.id, sh.label)}
                  className="min-h-[42px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-2.5 py-2 text-xs font-medium text-slate-200 text-left cursor-pointer"
                >
                  + {sh.label}
                </button>
              ))}
            </div>
          )}

          {activeAddTab === 'images' && (
            <div className="space-y-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[40px] rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Importar GIF, MP4 ou Imagem
              </button>
              <div className="max-h-44 overflow-y-auto space-y-1.5">
                {visualAssets.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">
                    Nenhum GIF, MP4 ou imagem importado.
                  </p>
                ) : (
                  visualAssets.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() =>
                        asset.kind === 'video' ? addVideoLayer(asset) : addImageLayer(asset)
                      }
                      className="w-full flex items-center gap-2 rounded-lg bg-[#1A1E28] hover:bg-white/10 p-2 text-left cursor-pointer"
                    >
                      {asset.thumbnailDataUrl ? (
                        <img
                          src={asset.thumbnailDataUrl}
                          alt={asset.name}
                          className="w-8 h-8 rounded object-cover shrink-0"
                        />
                      ) : (
                        <Film className="w-6 h-6 text-amber-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-slate-200 truncate block">{asset.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {asset.extension.toUpperCase()}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {activeAddTab === 'fx' && (
            <div className="space-y-2">
              <label className="block text-xs text-slate-300">Partículas da Cena</label>
              <select
                value={project.particles}
                onChange={(e) =>
                  onUpdateProject({
                    ...project,
                    particles: e.target.value as ParticlePreset,
                  })
                }
                className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-2 text-xs text-white"
              >
                <option value="none">Sem Partículas</option>
                <option value="rain">Chuva</option>
                <option value="snow">Neve</option>
                <option value="sparks">Faíscas</option>
                <option value="confetti">Confete</option>
              </select>
              <div className="pt-2 space-y-1.5">
                <span className="block text-xs text-slate-300">Cenário de Fundo Fixo (9:16)</span>
                <div className="flex items-center gap-2.5 rounded-lg bg-[#0B0D11] border border-white/10 p-2">
                  <img
                    src={STUDIO_BACKGROUND_IMAGE_URL}
                    alt="Cenário do Estúdio"
                    className="w-9 h-14 rounded object-cover border border-white/15 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white truncate">Estúdio Arte Digital DNS</p>
                    <p className="text-[10px] text-slate-400 font-mono">1080×1920 · 9:16 Único</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Layer Stack */}
          <div className="pt-3 border-t border-white/8 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Camadas ({project.layers.length})
              </span>
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {project.layers.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">Adicione um personagem ou objeto acima.</p>
              ) : (
                project.layers.map((layer) => (
                  <div
                    key={layer.id}
                    onClick={() => setSelectedLayerId(layer.id)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs cursor-pointer ${
                      layer.id === selectedLayerId
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-[#1A1E28] text-slate-300 border border-transparent hover:border-white/15'
                    }`}
                  >
                    <span className="truncate flex-1 font-medium">{layer.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateProject({
                          ...project,
                          layers: project.layers.map((l) =>
                            l.id === layer.id ? { ...l, visible: !l.visible } : l
                          ),
                        });
                      }}
                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateProject({
                          ...project,
                          layers: project.layers.filter((l) => l.id !== layer.id),
                        });
                        if (selectedLayerId === layer.id) setSelectedLayerId(null);
                      }}
                      className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center Stage Canvas */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-3">
          {/* Canvas Tool Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setToolMode('select')}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                  toolMode === 'select'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-[#1A1E28] text-slate-300'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" />
                Mover / Selecionar
              </button>
              <button
                onClick={() => setToolMode('brush')}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                  toolMode === 'brush'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-[#1A1E28] text-slate-300'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                Desenhar Quadro
              </button>
              {toolMode === 'brush' && (
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-8 h-8 rounded bg-transparent cursor-pointer"
                  />
                  <input
                    type="range"
                    min={2}
                    max={28}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-20 accent-amber-500"
                  />
                  <button
                    onClick={clearFrameStrokes}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-[11px] text-slate-300 cursor-pointer"
                  >
                    Limpar Traço
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setOnionSkin((v) => !v)}
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium cursor-pointer ${
                  onionSkin ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-[#1A1E28] text-slate-400'
                }`}
              >
                Papel Cebola
              </button>
              <button
                onClick={() => setShowGrid((v) => !v)}
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                  showGrid ? 'bg-white/10 text-white' : 'bg-[#1A1E28] text-slate-400'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
                Grade
              </button>
            </div>
          </div>

          <div className="w-full rounded-lg bg-[#0B0D11] border border-white/10 overflow-hidden flex items-center justify-center p-2">
            <canvas
              ref={canvasRef}
              width={project.width}
              height={project.height}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`max-h-[540px] w-auto max-w-full h-auto mx-auto block touch-none select-none ${
                toolMode === 'eyedropper'
                  ? 'cursor-cell'
                  : toolMode === 'brush'
                  ? 'cursor-crosshair'
                  : 'cursor-grab active:cursor-grabbing'
              }`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 px-1">
            {toolMode === 'eyedropper' ? (
              <span className="text-emerald-400 font-medium">
                Modo Conta-gotas ativo: clique na cor do fundo da imagem/vídeo no palco para removê-la.
              </span>
            ) : selectedLayer && selectedTransform ? (
              <span>
                Arraste o centro para mover · Cantos âmbar para redimensionar · Pino ciano para girar
              </span>
            ) : (
              <span>Clique em qualquer imagem ou objeto no palco para selecionar e redimensionar.</span>
            )}
            {selectedLayer && selectedTransform && (
              <span className="font-mono text-amber-300">
                {Math.round(selectedLayer.width * Math.abs(selectedTransform.scaleX))}×
                {Math.round(selectedLayer.height * Math.abs(selectedTransform.scaleY))} px
              </span>
            )}
          </div>
        </div>

        {/* Right Panel: Transform, Resize, Chroma Key, Keyframes & Custom Motion */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4 max-h-[680px] overflow-y-auto">
          {selectedLayer && selectedTransform ? (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/8">
                <h3 className="text-sm font-semibold text-white truncate">
                  {selectedLayer.name}
                </h3>
                <button
                  onClick={() =>
                    updateSelectedLayer((l) => upsertLayerKeyframe(l, safeFrameIndex, {}))
                  }
                  className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-300 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  title="Fixar Keyframe neste quadro"
                >
                  <Diamond className="w-3 h-3 fill-current" />
                  Keyframe Q{safeFrameIndex + 1}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Posição X</label>
                  <input
                    type="number"
                    value={Math.round(selectedTransform.x)}
                    onChange={(e) =>
                      updateSelectedLayer((l) =>
                        upsertLayerKeyframe(l, safeFrameIndex, { x: Number(e.target.value) })
                      )
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Posição Y</label>
                  <input
                    type="number"
                    value={Math.round(selectedTransform.y)}
                    onChange={(e) =>
                      updateSelectedLayer((l) =>
                        upsertLayerKeyframe(l, safeFrameIndex, { y: Number(e.target.value) })
                      )
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Resize Controls */}
              <div className="space-y-2 rounded-lg bg-[#0B0D11]/70 border border-white/8 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1.5">
                    <Maximize2 className="w-3 h-3 text-amber-400" />
                    Redimensionar
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setProportionalResize((v) => !v)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                        proportionalResize
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-white/5 text-slate-400 border border-white/10'
                      }`}
                    >
                      {proportionalResize ? 'Proporcional' : 'Livre X/Y'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const fitScale = Number(
                          Math.min(
                            project.width / Math.max(1, selectedLayer.width),
                            project.height / Math.max(1, selectedLayer.height)
                          ).toFixed(2)
                        );
                        updateSelectedLayer((l) =>
                          upsertLayerKeyframe(l, safeFrameIndex, {
                            x: Math.round(project.width / 2),
                            y: Math.round(project.height / 2),
                            scaleX: fitScale,
                            scaleY: fitScale,
                          })
                        );
                      }}
                      className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-medium cursor-pointer"
                      title="Ajustar imagem ao tamanho 9:16 do palco"
                    >
                      Ajustar 9:16
                    </button>
                  </div>
                </div>

                {proportionalResize ? (
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Tamanho (Escala)</span>
                      <span className="font-mono text-white">
                        {selectedTransform.scaleX.toFixed(2)}× (
                        {Math.round(selectedLayer.width * selectedTransform.scaleX)}×
                        {Math.round(selectedLayer.height * selectedTransform.scaleY)})
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={6}
                      step={0.05}
                      value={selectedTransform.scaleX}
                      onChange={(e) => {
                        const s = Number(e.target.value);
                        updateSelectedLayer((l) =>
                          upsertLayerKeyframe(l, safeFrameIndex, { scaleX: s, scaleY: s })
                        );
                      }}
                      className="w-full accent-amber-500"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Largura (X)</span>
                        <span className="font-mono text-white">{selectedTransform.scaleX.toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={6}
                        step={0.05}
                        value={selectedTransform.scaleX}
                        onChange={(e) =>
                          updateSelectedLayer((l) =>
                            upsertLayerKeyframe(l, safeFrameIndex, { scaleX: Number(e.target.value) })
                          )
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Altura (Y)</span>
                        <span className="font-mono text-white">{selectedTransform.scaleY.toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={6}
                        step={0.05}
                        value={selectedTransform.scaleY}
                        onChange={(e) =>
                          updateSelectedLayer((l) =>
                            upsertLayerKeyframe(l, safeFrameIndex, { scaleY: Number(e.target.value) })
                          )
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Rotação</span>
                  <span className="font-mono text-white">{Math.round(selectedTransform.rotation)}°</span>
                </div>
                <input
                  type="range"
                  min={-360}
                  max={360}
                  step={1}
                  value={selectedTransform.rotation}
                  onChange={(e) =>
                    updateSelectedLayer((l) =>
                      upsertLayerKeyframe(l, safeFrameIndex, { rotation: Number(e.target.value) })
                    )
                  }
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Opacidade</span>
                  <span className="font-mono text-white">
                    {Math.round(selectedTransform.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={selectedTransform.opacity}
                  onChange={(e) =>
                    updateSelectedLayer((l) =>
                      upsertLayerKeyframe(l, safeFrameIndex, { opacity: Number(e.target.value) })
                    )
                  }
                  className="w-full accent-amber-500"
                />
              </div>

              {/* Chroma Key directly inside the Animation Studio */}
              {(selectedLayer.kind === 'image' || selectedLayer.kind === 'video') && (
                <div className="rounded-lg bg-[#0B0D11]/80 border border-emerald-500/25 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLayer.chromaKey?.enabled ?? false}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            chromaKey: {
                              ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                              enabled: e.target.checked,
                            },
                          }))
                        }
                        className="accent-emerald-500 w-4 h-4"
                      />
                      Chroma Key (Remover Fundo)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setToolMode((m) => (m === 'eyedropper' ? 'select' : 'eyedropper'))
                      }
                      className={`px-2 py-1 rounded text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                        toolMode === 'eyedropper'
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-[#1A1E28] text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/15'
                      }`}
                      title="Capturar cor diretamente na imagem no palco"
                    >
                      <Pipette className="w-3 h-3" />
                      {toolMode === 'eyedropper' ? 'Clique na cor...' : 'Conta-gotas'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedLayer.chromaKey?.keyColor || '#00FF00'}
                      onChange={(e) =>
                        updateSelectedLayer((l) => ({
                          ...l,
                          chromaKey: {
                            ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                            enabled: true,
                            keyColor: e.target.value,
                          },
                        }))
                      }
                      className="w-8 h-7 rounded bg-transparent cursor-pointer shrink-0"
                    />
                    {[
                      { label: 'Verde', hex: '#00FF00' },
                      { label: 'Azul', hex: '#0000FF' },
                      { label: 'Branco', hex: '#FFFFFF' },
                      { label: 'Preto', hex: '#000000' },
                    ].map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        onClick={() =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            chromaKey: {
                              ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                              enabled: true,
                              keyColor: preset.hex,
                            },
                          }))
                        }
                        className="flex-1 py-1 rounded bg-[#1A1E28] hover:bg-white/10 text-[10px] text-slate-200 border border-white/10 cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {selectedLayer.chromaKey?.enabled && (
                    <div className="space-y-2 pt-1">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Similaridade</span>
                          <span className="font-mono text-white">
                            {selectedLayer.chromaKey.similarity}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={95}
                          value={selectedLayer.chromaKey.similarity}
                          onChange={(e) =>
                            updateSelectedLayer((l) => ({
                              ...l,
                              chromaKey: {
                                ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                                similarity: Number(e.target.value),
                              },
                            }))
                          }
                          className="w-full accent-emerald-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Suavidade de Borda</span>
                          <span className="font-mono text-white">
                            {selectedLayer.chromaKey.smoothness}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={60}
                          value={selectedLayer.chromaKey.smoothness}
                          onChange={(e) =>
                            updateSelectedLayer((l) => ({
                              ...l,
                              chromaKey: {
                                ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                                smoothness: Number(e.target.value),
                              },
                            }))
                          }
                          className="w-full accent-emerald-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Redução de Spill</span>
                          <span className="font-mono text-white">
                            {selectedLayer.chromaKey.spill}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={selectedLayer.chromaKey.spill}
                          onChange={(e) =>
                            updateSelectedLayer((l) => ({
                              ...l,
                              chromaKey: {
                                ...(l.chromaKey || DEFAULT_CHROMA_KEY),
                                spill: Number(e.target.value),
                              },
                            }))
                          }
                          className="w-full accent-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Movimento Personalizado
                </label>
                <select
                  value={selectedLayer.motionPreset}
                  onChange={(e) =>
                    updateSelectedLayer((l) => ({
                      ...l,
                      motionPreset: e.target.value as MotionPreset,
                    }))
                  }
                  className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-2 text-xs text-white"
                >
                  <option value="none">Nenhum (Manual por Keyframe)</option>
                  <option value="float">Flutuar Suave</option>
                  <option value="bounce">Quicar</option>
                  <option value="orbit">Órbita Circular</option>
                  <option value="shake">Tremor / Impacto</option>
                  <option value="pulse">Pulsar Escala</option>
                </select>
              </div>

              {selectedLayer.kind !== 'image' &&
                selectedLayer.kind !== 'video' &&
                selectedLayer.kind !== 'text' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Cor Principal</label>
                      <input
                        type="color"
                        value={selectedLayer.fillColor}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({ ...l, fillColor: e.target.value }))
                        }
                        className="w-full h-8 rounded bg-transparent cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Cor Destaque</label>
                      <input
                        type="color"
                        value={selectedLayer.accentColor}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({ ...l, accentColor: e.target.value }))
                        }
                        className="w-full h-8 rounded bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                )}

              <div className="pt-2 border-t border-white/8">
                <p className="text-[11px] text-slate-400 mb-1.5">
                  Keyframes da Camada ({selectedLayer.keyframes.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedLayer.keyframes.map((kf) => (
                    <button
                      key={kf.frameIndex}
                      onClick={() => setCurrentFrame(kf.frameIndex)}
                      className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer ${
                        kf.frameIndex === safeFrameIndex
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-[#1A1E28] text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      Q{kf.frameIndex + 1}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">
              Clique em uma imagem, vídeo ou personagem no palco para mover, redimensionar ou aplicar Chroma Key.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Multi-Track Animation Timeline */}
      <div className="rounded-xl bg-[#13161D] border border-white/8 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-white inline-flex items-center gap-1.5 mr-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Timeline
            </span>
            <span className="text-[11px] font-mono text-amber-300 bg-[#0B0D11] border border-white/10 px-2 py-1 rounded-md tabular-nums">
              {(
                project.frames
                  .slice(0, safeFrameIndex)
                  .reduce((acc, f) => acc + (f.durationMs || 42), 0) / 1000
              ).toFixed(2)}
              s /{' '}
              {(
                project.frames.reduce((acc, f) => acc + (f.durationMs || 42), 0) / 1000
              ).toFixed(2)}
              s
            </span>
            <button
              onClick={addFrame}
              className="min-h-[36px] px-3 rounded-lg bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Quadro
            </button>
            <button
              onClick={duplicateFrame}
              className="min-h-[36px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
              Duplicar
            </button>
            <button
              onClick={deleteFrame}
              disabled={project.frames.length <= 1}
              className="min-h-[36px] px-3 rounded-lg bg-[#1A1E28] hover:bg-red-500/20 disabled:opacity-40 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              Excluir
            </button>
            {selectedLayer && (
              <button
                onClick={() => {
                  const hasKey = selectedLayer.keyframes.some(
                    (k) => k.frameIndex === safeFrameIndex
                  );
                  if (hasKey && selectedLayer.keyframes.length > 1) {
                    updateSelectedLayer((l) => ({
                      ...l,
                      keyframes: l.keyframes.filter((k) => k.frameIndex !== safeFrameIndex),
                    }));
                  } else {
                    updateSelectedLayer((l) => upsertLayerKeyframe(l, safeFrameIndex, {}));
                  }
                }}
                className="min-h-[36px] px-3 rounded-lg bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 text-xs font-semibold text-cyan-300 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Diamond className="w-3 h-3 fill-current" />
                {selectedLayer.keyframes.some((k) => k.frameIndex === safeFrameIndex) &&
                selectedLayer.keyframes.length > 1
                  ? `Remover Keyframe Q${safeFrameIndex + 1}`
                  : `Marcar Keyframe Q${safeFrameIndex + 1}`}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-400 flex items-center gap-2">
              Duração (ms):
              <input
                type="number"
                min={16}
                max={5000}
                step={10}
                value={activeFrame?.durationMs || 42}
                onChange={(e) => {
                  const val = Math.max(16, Number(e.target.value));
                  onUpdateProject({
                    ...project,
                    frames: project.frames.map((f, idx) =>
                      idx === safeFrameIndex ? { ...f, durationMs: val } : f
                    ),
                  });
                }}
                className="w-18 rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1 text-xs text-white font-mono"
              />
            </label>
            <div className="flex items-center gap-1 bg-[#0B0D11] border border-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setTimelineZoom((z) => Math.max(46, z - 12))}
                className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
                title="Diminuir zoom da timeline"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTimelineZoom((z) => Math.min(116, z + 12))}
                className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
                title="Aumentar zoom da timeline"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Synchronized Multi-Track Timeline Grid */}
        <div className="rounded-lg bg-[#0B0D11] border border-white/10 overflow-x-auto">
          <div className="min-w-max">
            {/* Playhead Time Ruler */}
            <div className="flex border-b border-white/10 bg-[#151923]">
              <div className="w-44 shrink-0 sticky left-0 z-20 bg-[#151923] border-r border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                <span>Pistas / Camadas</span>
                <span className="font-mono text-slate-500">{project.frames.length}Q</span>
              </div>
              <div className="flex">
                {project.frames.map((frame, idx) => {
                  const active = idx === safeFrameIndex;
                  const tSec = (
                    project.frames
                      .slice(0, idx)
                      .reduce((acc, f) => acc + (f.durationMs || 42), 0) / 1000
                  ).toFixed(2);
                  return (
                    <button
                      key={`ruler-${frame.id}`}
                      type="button"
                      style={{ width: timelineZoom }}
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentFrame(idx);
                      }}
                      className={`shrink-0 py-1.5 px-1 border-r border-white/6 text-center transition-colors cursor-pointer relative ${
                        active ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:bg-white/5'
                      }`}
                    >
                      <div className="text-[10px] font-mono font-bold">Q{idx + 1}</div>
                      <div className="text-[9px] font-mono text-slate-500">{tSec}s</div>
                      {active && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Frame-by-frame Drawing & Duration Track */}
            <div className="flex border-b border-white/8 bg-[#10131A]">
              <div className="w-44 shrink-0 sticky left-0 z-20 bg-[#10131A] border-r border-white/10 px-3 py-2 text-[11px] font-medium text-cyan-300 flex items-center gap-1.5">
                <PenTool className="w-3 h-3 shrink-0" />
                <span className="truncate">Quadros / Traços</span>
              </div>
              <div className="flex">
                {project.frames.map((frame, idx) => {
                  const active = idx === safeFrameIndex;
                  return (
                    <button
                      key={frame.id}
                      type="button"
                      style={{ width: timelineZoom }}
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentFrame(idx);
                      }}
                      className={`shrink-0 h-11 px-1.5 border-r border-white/6 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                        active
                          ? 'bg-amber-500/15 ring-1 ring-inset ring-amber-500/60'
                          : 'hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[10px] font-mono text-slate-300">
                        {frame.durationMs}ms
                      </span>
                      {frame.strokes.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" title="Contém traço livre" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Individual Layer Keyframe Tracks */}
            {project.layers.length === 0 ? (
              <div className="px-4 py-4 text-xs text-slate-500">
                Adicione personagens, imagens, GIFs ou MP4 para animar na timeline.
              </div>
            ) : (
              project.layers.map((layer) => {
                const isSel = layer.id === selectedLayerId;
                const kfIndices = layer.keyframes.map((k) => k.frameIndex);
                const minKf = kfIndices.length > 0 ? Math.min(...kfIndices) : 0;
                const maxKf = kfIndices.length > 0 ? Math.max(...kfIndices) : project.frames.length - 1;

                return (
                  <div
                    key={`tl-${layer.id}`}
                    className={`flex border-b border-white/6 last:border-b-0 ${
                      isSel ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <div
                      onClick={() => setSelectedLayerId(layer.id)}
                      className={`w-44 shrink-0 sticky left-0 z-20 border-r border-white/10 px-2.5 py-2 flex items-center justify-between gap-1.5 cursor-pointer ${
                        isSel ? 'bg-[#1D1B16] text-amber-300' : 'bg-[#0F1218] text-slate-300'
                      }`}
                    >
                      <span className="text-[11px] font-medium truncate flex-1">{layer.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject({
                            ...project,
                            layers: project.layers.map((l) =>
                              l.id === layer.id ? { ...l, visible: !l.visible } : l
                            ),
                          });
                        }}
                        className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
                        title={layer.visible ? 'Ocultar camada' : 'Mostrar camada'}
                      >
                        {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject({
                            ...project,
                            layers: project.layers.map((l) =>
                              l.id === layer.id ? { ...l, locked: !l.locked } : l
                            ),
                          });
                        }}
                        className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
                        title={layer.locked ? 'Desbloquear camada' : 'Bloquear camada'}
                      >
                        {layer.locked ? (
                          <Lock className="w-3 h-3 text-amber-400" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    <div className="flex relative">
                      {project.frames.map((frame, idx) => {
                        const activeFrameCell = idx === safeFrameIndex;
                        const hasKey = layer.keyframes.some((k) => k.frameIndex === idx);
                        const inSpan =
                          kfIndices.length > 1
                            ? idx >= minKf && idx <= maxKf
                            : idx >= minKf;

                        return (
                          <button
                            key={`${layer.id}-cell-${frame.id}`}
                            type="button"
                            style={{ width: timelineZoom }}
                            onClick={() => {
                              setIsPlaying(false);
                              setSelectedLayerId(layer.id);
                              setCurrentFrame(idx);
                            }}
                            onDoubleClick={() => {
                              setSelectedLayerId(layer.id);
                              setCurrentFrame(idx);
                              const updated = layer.keyframes.some((k) => k.frameIndex === idx) &&
                                layer.keyframes.length > 1
                                ? {
                                    ...layer,
                                    keyframes: layer.keyframes.filter((k) => k.frameIndex !== idx),
                                  }
                                : upsertLayerKeyframe(layer, idx, {});
                              onUpdateProject({
                                ...project,
                                layers: project.layers.map((l) =>
                                  l.id === layer.id ? updated : l
                                ),
                              });
                            }}
                            className={`shrink-0 h-10 border-r border-white/6 flex items-center justify-center relative cursor-pointer ${
                              activeFrameCell ? 'bg-amber-500/12' : 'hover:bg-white/5'
                            }`}
                            title={`Q${idx + 1} · Duplo clique para alternar keyframe`}
                          >
                            {inSpan && (
                              <span
                                className={`absolute left-0 right-0 h-1.5 top-1/2 -translate-y-1/2 ${
                                  isSel ? 'bg-amber-500/35' : 'bg-cyan-500/20'
                                }`}
                              />
                            )}
                            {hasKey ? (
                              <Diamond
                                className={`relative z-10 w-3.5 h-3.5 fill-current ${
                                  activeFrameCell && isSel
                                    ? 'text-amber-400'
                                    : 'text-cyan-400'
                                }`}
                              />
                            ) : (
                              <span className="relative z-10 w-1 h-1 rounded-full bg-white/15" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
