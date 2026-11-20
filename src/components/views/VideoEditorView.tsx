import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Scissors,
  Trash2,
  Plus,
  Film,
  Image as ImageIcon,
  Type,
  Save,
  Volume2,
  VolumeX,
  Sliders,
  Music,
  Upload,
  Download,
  Copy,
  ArrowDownToLine,
  Layers,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MoveHorizontal,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useStageZoom } from '../../hooks/useStageZoom';
import {
  EdgeHoverTarget,
  StretchEdge,
  computeEdgeStretch,
  detectEdgeHit,
  drawEdgeStretchHandles,
  getEdgeStretchCursor,
} from '../../utils/edgeStretch';
import {
  AudioClip,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  MediaFile,
  StudioProject,
  VideoClip,
} from '../../types/studio';
import {
  applyChromaKeyToImageData,
  buildCssFilterString,
  drawStudioBackground,
  drawTextLayer,
  ensureStudioBackgroundLoaded,
} from '../../utils/canvasRenderer';
import {
  decodeAudioBlob,
  getAudioContext,
  getEffectiveMasterVolume,
  getMasterDestination,
} from '../../utils/audioEngine';
import {
  ALL_ACCEPTED_EXTENSIONS,
  formatDuration,
  processImportedFile,
} from '../../utils/mediaImporter';
import { DecodedGif, pickGifFrameAtTime } from '../../utils/gifDecoder';
import { AerialTimeline } from '../AerialTimeline';
import { STAGE_RESOLUTIONS, getAspectLabel } from '../../utils/resolutionPresets';
import { resizeProjectDimensions } from '../../storage/localDb';

interface VideoEditorViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  imageCache: Map<string, HTMLImageElement>;
  gifCache: Map<string, DecodedGif>;
  videoCache: Map<string, HTMLVideoElement>;
  onUpdateProject: (updated: StudioProject) => void;
  onSaveProject: () => Promise<void>;
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onDeleteMedia: (ids: string[]) => Promise<void>;
  onOpenExport?: () => void;
}

export const VideoEditorView: React.FC<VideoEditorViewProps> = ({
  project,
  mediaFiles,
  imageCache,
  gifCache,
  videoCache,
  onUpdateProject,
  onSaveProject,
  onImportMedia,
  onDeleteMedia,
  onOpenExport,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importTargetTrackRef = useRef<'video' | 'overlay'>('video');
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [mediaBinTab, setMediaBinTab] = useState<'visual' | 'audio'>('visual');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    project.videoClips[0]?.id || null
  );
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const [cutAnchor, setCutAnchor] = useState<{
    kind: 'video' | 'audio';
    clipId: string;
    track: 'overlay' | 'video' | 'audio';
    time: number;
  } | null>(null);

  const [edgeStretchEnabled, setEdgeStretchEnabled] = useState(true);
  const [hoverEdge, setHoverEdge] = useState<EdgeHoverTarget | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(() =>
    project.videoClips.some((c) => c.track === 'overlay')
  );
  const [overlayTrackOpen, setOverlayTrackOpen] = useState(() =>
    project.videoClips.some((c) => c.track === 'overlay')
  );
  const [rightOverlayPanelOpen, setRightOverlayPanelOpen] = useState(false);
  const [rightOverlayInspectorOpen, setRightOverlayInspectorOpen] = useState(true);

  const canvasDragRef = useRef<{
    active: boolean;
    mode: 'move' | 'resize' | 'stretch-edge' | 'rotate';
    clipId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origScale: number;
    origScaleX: number;
    origScaleY: number;
    origDist: number;
    origRotation: number;
    startAngle: number;
    stretchEdge?: StretchEdge;
    baseW?: number;
    baseH?: number;
  }>({
    active: false,
    mode: 'move',
    clipId: '',
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origScale: 1,
    origScaleX: 1,
    origScaleY: 1,
    origDist: 100,
    origRotation: 0,
    startAngle: 0,
  });

  const stageZoom = useStageZoom(stageViewportRef, {
    minZoom: 1,
    maxZoom: 5,
    initialEnabled: true,
    onPinchStart: () => {
      canvasDragRef.current.active = false;
    },
  });

  const timelineDragRef = useRef<{
    active: boolean;
    moved: boolean;
    kind: 'video' | 'audio';
    track: 'overlay' | 'video' | 'audio';
    mode: 'move' | 'trim-left' | 'trim-right';
    clipId: string;
    startClientX: number;
    clickTime: number;
    origStartTime: number;
    origTrimStart: number;
    origDuration: number;
    sourceDuration: number;
    speed: number;
    trackWidthPx: number;
  }>({
    active: false,
    moved: false,
    kind: 'video',
    track: 'video',
    mode: 'move',
    clipId: '',
    startClientX: 0,
    clickTime: 0,
    origStartTime: 0,
    origTrimStart: 0,
    origDuration: 0,
    sourceDuration: 0,
    speed: 1,
    trackWidthPx: 400,
  });

  const totalDuration = Math.max(
    6,
    ...project.videoClips.map((c) => c.startTime + c.duration / Math.max(0.25, c.speed)),
    ...project.audioClips.map((a) => a.startTime + a.duration / Math.max(0.25, a.speed))
  );

  const selectedClip = project.videoClips.find((c) => c.id === selectedClipId) || null;
  const selectedAudioClip = project.audioClips.find((c) => c.id === selectedAudioClipId) || null;

  const stopAudioNodes = () => {
    activeAudioNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // ignore stopped nodes
      }
    });
    activeAudioNodesRef.current = [];
  };

  // Synchronized audio playback with video playhead
  useEffect(() => {
    if (!isPlaying) {
      stopAudioNodes();
      return;
    }

    let cancelled = false;
    const playFrom = currentTime;

    const scheduleAudio = async () => {
      stopAudioNodes();
      if (project.audioClips.length === 0) return;

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const mediaMap = new Map(mediaFiles.map((m) => [m.id, m]));
      const hasSolo = project.audioClips.some((c) => c.solo);
      const activeAudio = project.audioClips.filter((c) => !c.muted && (!hasSolo || c.solo));

      // Pre-decode all active audio buffers first so scheduling is phase-locked
      const ready: Array<{ clip: AudioClip; buffer: AudioBuffer }> = [];
      for (const aclip of activeAudio) {
        if (cancelled) return;
        const mf = mediaMap.get(aclip.mediaId);
        if (!mf) continue;
        let buffer = audioBufferCacheRef.current.get(mf.id);
        if (!buffer) {
          try {
            const decoded = await decodeAudioBlob(mf.blob);
            buffer = decoded.buffer;
            audioBufferCacheRef.current.set(mf.id, buffer);
          } catch {
            continue;
          }
        }
        ready.push({ clip: aclip, buffer });
      }
      if (cancelled || ready.length === 0) return;

      const now = ctx.currentTime + 0.02;
      for (const { clip: aclip, buffer } of ready) {
        const playLen = aclip.duration / Math.max(0.25, aclip.speed);
        const clipEnd = aclip.startTime + playLen;
        if (playFrom >= clipEnd) continue;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = aclip.speed;

        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 120;
        bass.gain.value = aclip.eqBass;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.gain.value = aclip.eqMid;

        const treble = ctx.createBiquadFilter();
        treble.type = 'highshelf';
        treble.frequency.value = 6000;
        treble.gain.value = aclip.eqTreble;

        const gainNode = ctx.createGain();
        gainNode.gain.value = aclip.gain;

        src.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(gainNode);
        gainNode.connect(getMasterDestination());

        if (playFrom >= aclip.startTime) {
          const offsetInsideClip = (playFrom - aclip.startTime) * aclip.speed;
          const remainSrc = Math.max(0.02, aclip.duration - offsetInsideClip);
          src.start(now, aclip.trimStart + offsetInsideClip, remainSrc);
        } else {
          const delay = aclip.startTime - playFrom;
          src.start(now + delay, aclip.trimStart, aclip.duration);
        }
        activeAudioNodesRef.current.push(src);
      }
    };

    void scheduleAudio();

    return () => {
      cancelled = true;
      stopAudioNodes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      videoCache.forEach((v) => {
        if (!v.paused) v.pause();
      });
      return;
    }

    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, totalDuration, videoCache]);

  useEffect(() => {
    void ensureStudioBackgroundLoaded().then((img) => {
      if (img) setRenderTick((t) => (t + 1) % 1_000_000);
    });
  }, []);

  const getClipScale = (clip: VideoClip): { sx: number; sy: number } => ({
    sx: clip.scaleX ?? clip.scale,
    sy: clip.scaleY ?? clip.scale,
  });

  const getClipBaseDims = (clip: VideoClip): { w: number; h: number } => {
    if (clip.kind === 'image' && clip.mediaId) {
      const decodedGif = gifCache.get(clip.mediaId);
      const img = imageCache.get(clip.mediaId);
      const srcW = decodedGif ? decodedGif.width : img?.naturalWidth || 360;
      const srcH = decodedGif ? decodedGif.height : img?.naturalHeight || 360;
      const fit = Math.min(project.width / Math.max(1, srcW), project.height / Math.max(1, srcH));
      return { w: srcW * fit, h: srcH * fit };
    }
    if (clip.kind === 'video' && clip.mediaId) {
      const vel = videoCache.get(clip.mediaId);
      const vw = vel?.videoWidth || 540;
      const vh = vel?.videoHeight || 960;
      const fit = Math.min(project.width / Math.max(1, vw), project.height / Math.max(1, vh));
      return { w: vw * fit, h: vh * fit };
    }
    if (clip.kind === 'text') {
      return { w: 560, h: 140 };
    }
    return { w: project.width, h: project.height };
  };

  // Composite preview frame + interactive touch/mouse selection gizmo
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, project.width, project.height);
    drawStudioBackground(ctx, project.width, project.height, '#0B0D11');

    const activeClips = project.videoClips
      .filter((c) => {
        const end = c.startTime + c.duration / Math.max(0.25, c.speed);
        return currentTime >= c.startTime && currentTime <= end;
      })
      .sort((a, b) => (a.track === b.track ? 0 : a.track === 'video' ? -1 : 1));

    if (activeClips.length === 0) {
      ctx.fillStyle = 'rgba(11, 13, 17, 0.72)';
      ctx.beginPath();
      ctx.roundRect(project.width * 0.1, project.height / 2 - 42, project.width * 0.8, 84, 18);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'Adicione vídeos, imagens ou áudios na linha do tempo',
        project.width / 2,
        project.height / 2
      );
      return;
    }

    activeClips.forEach((clip) => {
      const elapsed = currentTime - clip.startTime;
      const playLen = clip.duration / Math.max(0.25, clip.speed);
      const localSrcTime = elapsed * clip.speed + clip.trimStart;

      let alpha = clip.opacity;
      if ((clip.transition === 'fade-in' || clip.transition === 'fade-both') && elapsed < 0.5) {
        alpha *= Math.max(0, elapsed / 0.5);
      }
      if ((clip.transition === 'fade-out' || clip.transition === 'fade-both') && playLen - elapsed < 0.5) {
        alpha *= Math.max(0, (playLen - elapsed) / 0.5);
      }

      const { sx, sy } = getClipScale(clip);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = buildCssFilterString(clip.effects || DEFAULT_EFFECTS);
      ctx.translate(project.width / 2 + clip.x, project.height / 2 + clip.y);
      ctx.rotate((clip.rotation * Math.PI) / 180);
      ctx.scale(sx, sy);

      if (clip.kind === 'color') {
        ctx.fillStyle = clip.backgroundColor || '#1E293B';
        ctx.fillRect(-project.width / 2, -project.height / 2, project.width, project.height);
      } else if (clip.kind === 'image' && clip.mediaId) {
        const decodedGif = gifCache.get(clip.mediaId);
        const gifFrame = decodedGif ? pickGifFrameAtTime(decodedGif, elapsed * 1000) : null;
        const img = imageCache.get(clip.mediaId);
        const sourceDrawable: CanvasImageSource | null =
          gifFrame || (img && img.naturalWidth > 0 ? img : null);

        if (sourceDrawable) {
          const srcW = decodedGif ? decodedGif.width : img!.naturalWidth;
          const srcH = decodedGif ? decodedGif.height : img!.naturalHeight;
          const fit = Math.min(project.width / Math.max(1, srcW), project.height / Math.max(1, srcH));
          const dw = srcW * fit;
          const dh = srcH * fit;
          if (clip.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(dw));
            off.height = Math.max(1, Math.round(dh));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(sourceDrawable, 0, 0, off.width, off.height);
              const data = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(data, clip.chromaKey);
              octx.putImageData(data, 0, 0);
              ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
            }
          } else {
            ctx.drawImage(sourceDrawable, -dw / 2, -dh / 2, dw, dh);
          }
        }
      } else if (clip.kind === 'video' && clip.mediaId) {
        const vel = videoCache.get(clip.mediaId);
        if (vel && vel.readyState >= 2) {
          const targetT = Math.min(vel.duration || localSrcTime, localSrcTime);
          if (isPlaying) {
            const masterVol = getEffectiveMasterVolume();
            vel.playbackRate = Math.max(0.25, Math.min(4, clip.speed));
            vel.volume = Math.max(0, Math.min(1, clip.volume * masterVol));
            vel.muted = masterVol <= 0.001 || clip.volume <= 0.001;
            if (Math.abs(vel.currentTime - targetT) > 0.45) {
              vel.currentTime = targetT;
            }
            if (vel.paused) {
              void vel.play().catch(() => {
                vel.muted = true;
                void vel.play().catch(() => {});
              });
            }
          } else {
            if (!vel.paused) vel.pause();
            if (Math.abs(vel.currentTime - targetT) > 0.04) {
              vel.onseeked = () => setRenderTick((t) => (t + 1) % 1_000_000);
              vel.currentTime = targetT;
            }
          }
          const fit = Math.min(project.width / vel.videoWidth, project.height / vel.videoHeight);
          const dw = vel.videoWidth * fit;
          const dh = vel.videoHeight * fit;
          if (clip.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(dw));
            off.height = Math.max(1, Math.round(dh));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(vel, 0, 0, off.width, off.height);
              const data = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(data, clip.chromaKey);
              octx.putImageData(data, 0, 0);
              ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
            }
          } else {
            ctx.drawImage(vel, -dw / 2, -dh / 2, dw, dh);
          }
        }
      } else if (clip.kind === 'text' && clip.textConfig) {
        drawTextLayer(ctx, clip.textConfig, Math.min(1, elapsed / Math.max(0.1, playLen)));
      }

      ctx.restore();
    });

    // Selection gizmo for active selected clip when paused
    if (!isPlaying && selectedClip) {
      const isActiveSel = activeClips.some((c) => c.id === selectedClip.id);
      if (isActiveSel) {
        const { w, h } = getClipBaseDims(selectedClip);
        const { sx, sy } = getClipScale(selectedClip);
        const halfW = (w * Math.abs(sx)) / 2 + 10;
        const halfH = (h * Math.abs(sy)) / 2 + 10;
        const cx = project.width / 2 + selectedClip.x;
        const cy = project.height / 2 + selectedClip.y;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((selectedClip.rotation * Math.PI) / 180);

        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
        ctx.setLineDash([]);

        const corners = [
          [-halfW, -halfH],
          [halfW, -halfH],
          [halfW, halfH],
          [-halfW, halfH],
        ];
        corners.forEach(([hx, hy]) => {
          ctx.fillStyle = '#0B0D11';
          ctx.fillRect(hx - 12, hy - 12, 24, 24);
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(hx - 9, hy - 9, 18, 18);
        });

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

        if (edgeStretchEnabled) {
          drawEdgeStretchHandles(ctx, {
            cx,
            cy,
            halfW,
            halfH,
            rotationDeg: selectedClip.rotation,
            hoveredEdge: hoverEdge?.id === selectedClip.id ? hoverEdge.edge : null,
            drawPreviewOutline: false,
          });
        }
      }
    }

    // Hover preview when passing mouse over the edge/end of an unselected clip
    if (!isPlaying && edgeStretchEnabled && hoverEdge && hoverEdge.id !== selectedClipId) {
      const hoveredClip = activeClips.find((c) => c.id === hoverEdge.id);
      if (hoveredClip) {
        const { w, h } = getClipBaseDims(hoveredClip);
        const { sx, sy } = getClipScale(hoveredClip);
        const halfW = (w * Math.abs(sx)) / 2 + 10;
        const halfH = (h * Math.abs(sy)) / 2 + 10;
        drawEdgeStretchHandles(ctx, {
          cx: project.width / 2 + hoveredClip.x,
          cy: project.height / 2 + hoveredClip.y,
          halfW,
          halfH,
          rotationDeg: hoveredClip.rotation,
          hoveredEdge: hoverEdge.edge,
          drawPreviewOutline: true,
        });
      }
    }
  }, [
    project,
    currentTime,
    imageCache,
    gifCache,
    videoCache,
    isPlaying,
    renderTick,
    selectedClip,
    selectedClipId,
    edgeStretchEnabled,
    hoverEdge,
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

  const toClipLocalSpace = (pt: { x: number; y: number }, clip: VideoClip) => {
    const cx = project.width / 2 + clip.x;
    const cy = project.height / 2 + clip.y;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const rad = (-clip.rotation * Math.PI) / 180;
    return {
      rx: dx * Math.cos(rad) - dy * Math.sin(rad),
      ry: dx * Math.sin(rad) + dy * Math.cos(rad),
      cx,
      cy,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (stageZoom.isMultiTouchBlocked()) return;

    // Middle mouse or Alt+drag pans the zoomed stage even during playback
    if (e.button === 1 || (e.altKey && stageZoom.zoom > 1.01)) {
      e.preventDefault();
      stageZoom.startPanDrag(e.clientX, e.clientY);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (isPlaying) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);

    const activeClips = project.videoClips
      .filter((c) => {
        const end = c.startTime + c.duration / Math.max(0.25, c.speed);
        return currentTime >= c.startTime && currentTime <= end;
      })
      .sort((a, b) => (a.track === b.track ? 0 : a.track === 'video' ? -1 : 1));

    const findClipEdgeTarget = (
      probe: { x: number; y: number }
    ): { clip: VideoClip; edge: StretchEdge } | null => {
      if (selectedClip && activeClips.some((c) => c.id === selectedClip.id)) {
        const { w, h } = getClipBaseDims(selectedClip);
        const { sx, sy } = getClipScale(selectedClip);
        const hw = (w * Math.abs(sx)) / 2 + 10;
        const hh = (h * Math.abs(sy)) / 2 + 10;
        const edge = detectEdgeHit(
          probe,
          {
            cx: project.width / 2 + selectedClip.x,
            cy: project.height / 2 + selectedClip.y,
            halfW: hw,
            halfH: hh,
            rotationDeg: selectedClip.rotation,
          },
          24,
          18
        );
        if (edge) return { clip: selectedClip, edge };
      }

      for (let i = activeClips.length - 1; i >= 0; i--) {
        const clip = activeClips[i];
        if (clip.id === selectedClipId) continue;
        const { w, h } = getClipBaseDims(clip);
        const { sx, sy } = getClipScale(clip);
        const hw = (w * Math.abs(sx)) / 2 + 10;
        const hh = (h * Math.abs(sy)) / 2 + 10;
        const edge = detectEdgeHit(
          probe,
          {
            cx: project.width / 2 + clip.x,
            cy: project.height / 2 + clip.y,
            halfW: hw,
            halfH: hh,
            rotationDeg: clip.rotation,
          },
          22,
          12
        );
        if (edge) return { clip, edge };
      }
      return null;
    };

    // Check resize & rotation handles of currently selected clip
    if (selectedClip && activeClips.some((c) => c.id === selectedClip.id)) {
      const { w, h } = getClipBaseDims(selectedClip);
      const { sx, sy } = getClipScale(selectedClip);
      const halfW = (w * Math.abs(sx)) / 2 + 10;
      const halfH = (h * Math.abs(sy)) / 2 + 10;
      const { rx, ry, cx, cy } = toClipLocalSpace(pt, selectedClip);

      if (Math.hypot(rx, ry - (-halfH - 46)) <= 44) {
        canvasDragRef.current = {
          active: true,
          mode: 'rotate',
          clipId: selectedClip.id,
          startX: pt.x,
          startY: pt.y,
          origX: selectedClip.x,
          origY: selectedClip.y,
          origScale: selectedClip.scale,
          origScaleX: sx,
          origScaleY: sy,
          origDist: 100,
          origRotation: selectedClip.rotation,
          startAngle: Math.atan2(pt.y - cy, pt.x - cx),
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      const corners = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
      ];
      if (corners.some(([hx, hy]) => Math.hypot(rx - hx, ry - hy) <= 46)) {
        canvasDragRef.current = {
          active: true,
          mode: 'resize',
          clipId: selectedClip.id,
          startX: pt.x,
          startY: pt.y,
          origX: selectedClip.x,
          origY: selectedClip.y,
          origScale: selectedClip.scale,
          origScaleX: sx,
          origScaleY: sy,
          origDist: Math.max(20, Math.hypot(pt.x - cx, pt.y - cy)),
          origRotation: selectedClip.rotation,
          startAngle: 0,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }

    // Check edge stretch handle on selected or hovered clip when pointer is on the edge/end
    if (edgeStretchEnabled) {
      const edgeHit = findClipEdgeTarget(pt);
      if (edgeHit) {
        const target = edgeHit.clip;
        const { w, h } = getClipBaseDims(target);
        const { sx, sy } = getClipScale(target);
        setSelectedClipId(target.id);
        setSelectedAudioClipId(null);
        setHoverEdge({ id: target.id, edge: edgeHit.edge });
        setHoverCursor(getEdgeStretchCursor(edgeHit.edge, target.rotation));
        canvasDragRef.current = {
          active: true,
          mode: 'stretch-edge',
          clipId: target.id,
          startX: pt.x,
          startY: pt.y,
          origX: target.x,
          origY: target.y,
          origScale: target.scale,
          origScaleX: sx,
          origScaleY: sy,
          origDist: 100,
          origRotation: target.rotation,
          startAngle: 0,
          stretchEdge: edgeHit.edge,
          baseW: w,
          baseH: h,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }

    // Hit test active clips top-to-bottom for touch/mouse move
    let hitClip: VideoClip | null = null;
    for (let i = activeClips.length - 1; i >= 0; i--) {
      const clip = activeClips[i];
      const { w, h } = getClipBaseDims(clip);
      const { sx, sy } = getClipScale(clip);
      const halfW = (w * Math.abs(sx)) / 2 + 18;
      const halfH = (h * Math.abs(sy)) / 2 + 18;
      const { rx, ry } = toClipLocalSpace(pt, clip);
      if (Math.abs(rx) <= halfW && Math.abs(ry) <= halfH) {
        hitClip = clip;
        break;
      }
    }

    if (hitClip) {
      if (e.pointerType === 'touch' && stageZoom.handleTouchDoubleTapCheck(e.clientX, e.clientY, true)) {
        return;
      }
      const { sx, sy } = getClipScale(hitClip);
      setSelectedClipId(hitClip.id);
      setSelectedAudioClipId(null);
      canvasDragRef.current = {
        active: true,
        mode: 'move',
        clipId: hitClip.id,
        startX: pt.x,
        startY: pt.y,
        origX: hitClip.x,
        origY: hitClip.y,
        origScale: hitClip.scale,
        origScaleX: sx,
        origScaleY: sy,
        origDist: 100,
        origRotation: hitClip.rotation,
        startAngle: 0,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      if (e.pointerType === 'touch' && stageZoom.handleTouchDoubleTapCheck(e.clientX, e.clientY, true)) {
        return;
      }
      if (stageZoom.zoom > 1.01) {
        stageZoom.startPanDrag(e.clientX, e.clientY);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else {
        setSelectedClipId(null);
      }
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (stageZoom.isMultiTouchBlocked()) return;
    if (stageZoom.movePanDrag(e.clientX, e.clientY)) return;
    const drag = canvasDragRef.current;
    const pt = toCanvasCoords(e.clientX, e.clientY);

    if (!drag.active) {
      if (!isPlaying && edgeStretchEnabled) {
        const activeClips = project.videoClips
          .filter((c) => {
            const end = c.startTime + c.duration / Math.max(0.25, c.speed);
            return currentTime >= c.startTime && currentTime <= end;
          })
          .sort((a, b) => (a.track === b.track ? 0 : a.track === 'video' ? -1 : 1));

        let nextTarget: EdgeHoverTarget | null = null;
        let nextCursor: string | null = null;

        if (selectedClip && activeClips.some((c) => c.id === selectedClip.id)) {
          const { w, h } = getClipBaseDims(selectedClip);
          const { sx, sy } = getClipScale(selectedClip);
          const edge = detectEdgeHit(
            pt,
            {
              cx: project.width / 2 + selectedClip.x,
              cy: project.height / 2 + selectedClip.y,
              halfW: (w * Math.abs(sx)) / 2 + 10,
              halfH: (h * Math.abs(sy)) / 2 + 10,
              rotationDeg: selectedClip.rotation,
            },
            24,
            18
          );
          if (edge) {
            nextTarget = { id: selectedClip.id, edge };
            nextCursor = getEdgeStretchCursor(edge, selectedClip.rotation);
          }
        }

        if (!nextTarget) {
          for (let i = activeClips.length - 1; i >= 0; i--) {
            const c = activeClips[i];
            if (c.id === selectedClipId) continue;
            const { w, h } = getClipBaseDims(c);
            const { sx, sy } = getClipScale(c);
            const edge = detectEdgeHit(
              pt,
              {
                cx: project.width / 2 + c.x,
                cy: project.height / 2 + c.y,
                halfW: (w * Math.abs(sx)) / 2 + 10,
                halfH: (h * Math.abs(sy)) / 2 + 10,
                rotationDeg: c.rotation,
              },
              22,
              12
            );
            if (edge) {
              nextTarget = { id: c.id, edge };
              nextCursor = getEdgeStretchCursor(edge, c.rotation);
              break;
            }
          }
        }

        if (nextTarget?.id !== hoverEdge?.id || nextTarget?.edge !== hoverEdge?.edge) {
          setHoverEdge(nextTarget);
        }
        if (nextCursor !== hoverCursor) {
          setHoverCursor(nextCursor);
        }
      } else if (hoverEdge || hoverCursor) {
        setHoverEdge(null);
        setHoverCursor(null);
      }
      return;
    }

    const target = project.videoClips.find((c) => c.id === drag.clipId);
    if (!target) return;

    if (drag.mode === 'move') {
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId
            ? { ...c, x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) }
            : c
        ),
      });
    } else if (drag.mode === 'stretch-edge' && drag.stretchEdge) {
      const stretched = computeEdgeStretch({
        edge: drag.stretchEdge,
        pt,
        origCx: project.width / 2 + drag.origX,
        origCy: project.height / 2 + drag.origY,
        baseW: drag.baseW || project.width,
        baseH: drag.baseH || project.height,
        origScaleX: drag.origScaleX,
        origScaleY: drag.origScaleY,
        rotationDeg: drag.origRotation,
      });
      const avgScale = Number(((Math.abs(stretched.scaleX) + Math.abs(stretched.scaleY)) / 2).toFixed(2));
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId
            ? {
                ...c,
                x: Math.round(stretched.cx - project.width / 2),
                y: Math.round(stretched.cy - project.height / 2),
                scale: avgScale,
                scaleX: Number(stretched.scaleX.toFixed(2)),
                scaleY: Number(stretched.scaleY.toFixed(2)),
              }
            : c
        ),
      });
    } else if (drag.mode === 'resize') {
      const cx = project.width / 2 + target.x;
      const cy = project.height / 2 + target.y;
      const dist = Math.hypot(pt.x - cx, pt.y - cy);
      const factor = dist / Math.max(20, drag.origDist);
      const nextScale = Number(Math.max(0.1, Math.min(5, drag.origScale * factor)).toFixed(2));
      const nextSx = Number(Math.max(0.1, Math.min(8, drag.origScaleX * factor)).toFixed(2));
      const nextSy = Number(Math.max(0.1, Math.min(8, drag.origScaleY * factor)).toFixed(2));
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId ? { ...c, scale: nextScale, scaleX: nextSx, scaleY: nextSy } : c
        ),
      });
    } else if (drag.mode === 'rotate') {
      const cx = project.width / 2 + target.x;
      const cy = project.height / 2 + target.y;
      const angle = Math.atan2(pt.y - cy, pt.x - cx);
      const deltaDeg = ((angle - drag.startAngle) * 180) / Math.PI;
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId ? { ...c, rotation: Math.round(drag.origRotation + deltaDeg) } : c
        ),
      });
    }
  };

  const handleCanvasPointerUp = () => {
    if (stageZoom.panDragRef.current.active) {
      const moved = stageZoom.endPanDrag();
      if (!moved) {
        setSelectedClipId(null);
      }
    }
    canvasDragRef.current.active = false;
  };

  const appendClipFromMedia = (mf: MediaFile, targetTrack: 'video' | 'overlay' = 'video') => {
    const isOverlay = targetTrack === 'overlay';
    const existingEnd = project.videoClips
      .filter((c) => c.track === targetTrack)
      .reduce((max, c) => Math.max(max, c.startTime + c.duration / Math.max(0.25, c.speed)), 0);

    const clip: VideoClip = {
      id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      track: targetTrack,
      mediaId: mf.id,
      name: isOverlay ? `${mf.name} (Sobreposição)` : mf.name,
      kind: mf.kind === 'video' ? 'video' : 'image',
      startTime: isOverlay ? Number(currentTime.toFixed(2)) : existingEnd,
      duration: mf.kind === 'video' ? Math.max(1, mf.duration || 5) : 4,
      trimStart: 0,
      speed: 1,
      volume: 1,
      x: 0,
      y: isOverlay ? -120 : 0,
      scale: isOverlay ? 0.55 : 1,
      rotation: 0,
      opacity: 1,
      transition: 'none',
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
    };

    onUpdateProject({
      ...project,
      lastTool: 'video',
      videoClips: [...project.videoClips, clip],
    });
    if (isOverlay) setOverlayTrackOpen(true);
    setSelectedClipId(clip.id);
    setSelectedAudioClipId(null);
  };

  const appendAudioClipFromMedia = async (mf: MediaFile) => {
    let peaks: number[] = Array.from({ length: 64 }, () => 0.35);
    let dur = mf.duration || 5;
    try {
      const decoded = await decodeAudioBlob(mf.blob);
      audioBufferCacheRef.current.set(mf.id, decoded.buffer);
      peaks = decoded.peaks;
      dur = decoded.duration;
    } catch {
      // fallback
    }

    const existingAudioEnd = project.audioClips.reduce(
      (max, c) => Math.max(max, c.startTime + c.duration / Math.max(0.25, c.speed)),
      0
    );

    const aclip: AudioClip = {
      id: `aclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      mediaId: mf.id,
      name: mf.name,
      startTime: project.audioClips.length === 0 ? 0 : Number(existingAudioEnd.toFixed(2)),
      duration: Number(dur.toFixed(2)),
      sourceDuration: Number(dur.toFixed(2)),
      trimStart: 0,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      speed: 1,
      eqBass: 0,
      eqMid: 0,
      eqTreble: 0,
      muted: false,
      solo: false,
      peaks,
    };

    onUpdateProject({
      ...project,
      lastTool: 'video',
      audioClips: [...project.audioClips, aclip],
    });
    setSelectedAudioClipId(aclip.id);
    setSelectedClipId(null);
  };

  const handleDirectMediaImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imported: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const mf = await processImportedFile(file, file.name, 'internal');
      if (mf) imported.push(mf);
    }
    if (imported.length === 0) return;

    await onImportMedia(imported);
    const first = imported[0];
    const targetTrack = importTargetTrackRef.current;
    importTargetTrackRef.current = 'video';

    if (first.kind === 'audio') {
      setMediaBinTab('audio');
      await appendAudioClipFromMedia(first);
    } else {
      setMediaBinTab('visual');
      appendClipFromMedia(first, targetTrack);
    }
  };

  const addOverlayTextClip = () => {
    const clip: VideoClip = {
      id: `vclip-${Date.now()}`,
      track: 'overlay',
      name: 'Legenda / Título',
      kind: 'text',
      startTime: currentTime,
      duration: 3.5,
      trimStart: 0,
      speed: 1,
      volume: 1,
      x: 0,
      y: project.height * 0.3,
      scale: 1,
      rotation: 0,
      opacity: 1,
      transition: 'fade-both',
      textConfig: {
        text: 'LEGENDAS DO VÍDEO',
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 44,
        fontWeight: '800',
        color: '#F8FAFC',
        strokeColor: '#0B0D11',
        strokeWidth: 4,
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.6)',
        backgroundColor: 'rgba(11,13,17,0.65)',
        backgroundPadding: 14,
        animation: 'slide-up',
        align: 'center',
      },
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
    };

    onUpdateProject({
      ...project,
      lastTool: 'video',
      videoClips: [...project.videoClips, clip],
    });
    setSelectedClipId(clip.id);
    setSelectedAudioClipId(null);
  };

  const updateSelectedClip = (patch: Partial<VideoClip>) => {
    if (!selectedClip) return;
    onUpdateProject({
      ...project,
      videoClips: project.videoClips.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c)),
    });
  };

  const updateSelectedAudioClip = (patch: Partial<AudioClip>) => {
    if (!selectedAudioClip) return;
    onUpdateProject({
      ...project,
      audioClips: project.audioClips.map((a) =>
        a.id === selectedAudioClip.id ? { ...a, ...patch } : a
      ),
    });
  };

  const duplicateSelectedClip = (forceMainTrack = false) => {
    if (selectedClip) {
      const targetTrack: 'video' | 'overlay' = forceMainTrack ? 'video' : selectedClip.track;
      const playDur = selectedClip.duration / Math.max(0.25, selectedClip.speed);

      let insertTime: number;
      if (selectedClip.track === targetTrack) {
        insertTime = Number((selectedClip.startTime + playDur).toFixed(2));
      } else {
        const trackEnd = project.videoClips
          .filter((c) => c.track === targetTrack)
          .reduce(
            (max, c) => Math.max(max, c.startTime + c.duration / Math.max(0.25, c.speed)),
            0
          );
        insertTime = Number(trackEnd.toFixed(2));
      }

      const duplicate: VideoClip = {
        ...selectedClip,
        id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        track: targetTrack,
        name: selectedClip.name.includes('(Cópia)')
          ? selectedClip.name
          : `${selectedClip.name} (Cópia)`,
        startTime: insertTime,
        effects: { ...selectedClip.effects },
        chromaKey: selectedClip.chromaKey
          ? { ...selectedClip.chromaKey }
          : { ...DEFAULT_CHROMA_KEY },
        textConfig: selectedClip.textConfig ? { ...selectedClip.textConfig } : undefined,
      };

      // Shift subsequent clips on the same track so the duplicate inserts cleanly in the timeline
      const shiftedClips = project.videoClips.map((c) => {
        if (c.track === targetTrack && c.id !== selectedClip.id && c.startTime >= insertTime - 0.05) {
          return { ...c, startTime: Number((c.startTime + playDur).toFixed(2)) };
        }
        return c;
      });

      onUpdateProject({
        ...project,
        lastTool: 'video',
        videoClips: [...shiftedClips, duplicate],
      });
      setSelectedClipId(duplicate.id);
      setSelectedAudioClipId(null);
      return;
    }

    if (selectedAudioClip) {
      const playDur = selectedAudioClip.duration / Math.max(0.25, selectedAudioClip.speed);
      const insertTime = Number((selectedAudioClip.startTime + playDur).toFixed(2));
      const duplicate: AudioClip = {
        ...selectedAudioClip,
        id: `aclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: selectedAudioClip.name.includes('(Cópia)')
          ? selectedAudioClip.name
          : `${selectedAudioClip.name} (Cópia)`,
        startTime: insertTime,
        peaks: [...selectedAudioClip.peaks],
      };

      onUpdateProject({
        ...project,
        lastTool: 'video',
        audioClips: [...project.audioClips, duplicate],
      });
      setSelectedAudioClipId(duplicate.id);
      setSelectedClipId(null);
    }
  };

  const insertSelectedIntoMainVideoTrack = () => {
    if (!selectedClip) return;
    if (selectedClip.track === 'video') {
      // Already on Vídeo Principal -> duplicate & insert right after on the same timeline
      duplicateSelectedClip(true);
      return;
    }

    const playDur = selectedClip.duration / Math.max(0.25, selectedClip.speed);
    const insertTime = Number(currentTime.toFixed(2));
    const shiftedClips = project.videoClips.map((c) => {
      if (c.id === selectedClip.id) {
        return { ...c, track: 'video' as const, startTime: insertTime };
      }
      if (c.track === 'video' && c.startTime >= insertTime - 0.05) {
        return { ...c, startTime: Number((c.startTime + playDur).toFixed(2)) };
      }
      return c;
    });

    onUpdateProject({
      ...project,
      lastTool: 'video',
      videoClips: shiftedClips,
    });
  };

  const createOverlayFromSelected = () => {
    if (!selectedClip) return;
    const overlayClip: VideoClip = {
      ...selectedClip,
      id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      track: 'overlay',
      name: selectedClip.name.includes('(Sobreposição)')
        ? selectedClip.name
        : `${selectedClip.name} (Sobreposição)`,
      startTime: Number(currentTime.toFixed(2)),
      scale: Number(Math.min(selectedClip.scale, 0.55).toFixed(2)),
      y: selectedClip.track === 'video' ? -100 : selectedClip.y + 40,
      effects: { ...selectedClip.effects },
      chromaKey: selectedClip.chromaKey
        ? { ...selectedClip.chromaKey }
        : { ...DEFAULT_CHROMA_KEY },
      textConfig: selectedClip.textConfig ? { ...selectedClip.textConfig } : undefined,
    };

    onUpdateProject({
      ...project,
      lastTool: 'video',
      videoClips: [...project.videoClips, overlayClip],
    });
    setOverlayTrackOpen(true);
    setSelectedClipId(overlayClip.id);
    setSelectedAudioClipId(null);
  };

  const deleteSelectedFromTimeline = () => {
    if (selectedClip) {
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.filter((c) => c.id !== selectedClip.id),
      });
      setSelectedClipId(null);
      setCutAnchor(null);
      return;
    }
    if (selectedAudioClip) {
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.filter((a) => a.id !== selectedAudioClip.id),
      });
      setSelectedAudioClipId(null);
      setCutAnchor(null);
    }
  };

  const splitClipAtTime = (kind: 'video' | 'audio', clipId: string, targetTime: number) => {
    if (kind === 'video') {
      const clip = project.videoClips.find((c) => c.id === clipId);
      if (!clip) return;
      const spd = Math.max(0.25, clip.speed);
      const clipEnd = clip.startTime + clip.duration / spd;
      if (targetTime <= clip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;

      const firstPlayDur = targetTime - clip.startTime;
      const firstSourceDur = firstPlayDur * spd;
      const remainSourceDur = Math.max(0.15, clip.duration - firstSourceDur);

      const firstHalf: VideoClip = {
        ...clip,
        duration: Number(firstSourceDur.toFixed(2)),
      };
      const secondHalf: VideoClip = {
        ...clip,
        id: `vclip-${Date.now()}`,
        name: `${clip.name} (Parte 2)`,
        startTime: Number(targetTime.toFixed(2)),
        trimStart: Number((clip.trimStart + firstSourceDur).toFixed(2)),
        duration: Number(remainSourceDur.toFixed(2)),
      };

      onUpdateProject({
        ...project,
        videoClips: project.videoClips.flatMap((c) =>
          c.id === clip.id ? [firstHalf, secondHalf] : [c]
        ),
      });
      setSelectedClipId(secondHalf.id);
      setCutAnchor(null);
      return;
    }

    const aclip = project.audioClips.find((a) => a.id === clipId);
    if (!aclip) return;
    const spd = Math.max(0.25, aclip.speed);
    const clipEnd = aclip.startTime + aclip.duration / spd;
    if (targetTime <= aclip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;

    const firstPlayDur = targetTime - aclip.startTime;
    const firstSourceDur = firstPlayDur * spd;
    const remainSourceDur = Math.max(0.15, aclip.duration - firstSourceDur);

    const firstHalf: AudioClip = {
      ...aclip,
      duration: Number(firstSourceDur.toFixed(2)),
    };
    const secondHalf: AudioClip = {
      ...aclip,
      id: `aclip-${Date.now()}`,
      name: `${aclip.name} (Parte 2)`,
      startTime: Number(targetTime.toFixed(2)),
      trimStart: Number((aclip.trimStart + firstSourceDur).toFixed(2)),
      duration: Number(remainSourceDur.toFixed(2)),
    };

    onUpdateProject({
      ...project,
      audioClips: project.audioClips.flatMap((a) =>
        a.id === aclip.id ? [firstHalf, secondHalf] : [a]
      ),
    });
    setSelectedAudioClipId(secondHalf.id);
    setCutAnchor(null);
  };

  const trimClipBeforeTime = (kind: 'video' | 'audio', clipId: string, targetTime: number) => {
    if (kind === 'video') {
      const clip = project.videoClips.find((c) => c.id === clipId);
      if (!clip) return;
      const spd = Math.max(0.25, clip.speed);
      const clipEnd = clip.startTime + clip.duration / spd;
      if (targetTime <= clip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;
      const cutSourceDur = (targetTime - clip.startTime) * spd;
      const remainSourceDur = Math.max(0.15, clip.duration - cutSourceDur);
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                startTime: Number(targetTime.toFixed(2)),
                trimStart: Number((c.trimStart + cutSourceDur).toFixed(2)),
                duration: Number(remainSourceDur.toFixed(2)),
              }
            : c
        ),
      });
      setCutAnchor(null);
      return;
    }

    const aclip = project.audioClips.find((a) => a.id === clipId);
    if (!aclip) return;
    const spd = Math.max(0.25, aclip.speed);
    const clipEnd = aclip.startTime + aclip.duration / spd;
    if (targetTime <= aclip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;
    const cutSourceDur = (targetTime - aclip.startTime) * spd;
    const remainSourceDur = Math.max(0.15, aclip.duration - cutSourceDur);
    onUpdateProject({
      ...project,
      audioClips: project.audioClips.map((a) =>
        a.id === aclip.id
          ? {
              ...a,
              startTime: Number(targetTime.toFixed(2)),
              trimStart: Number((a.trimStart + cutSourceDur).toFixed(2)),
              duration: Number(remainSourceDur.toFixed(2)),
            }
          : a
      ),
    });
    setCutAnchor(null);
  };

  const trimClipAfterTime = (kind: 'video' | 'audio', clipId: string, targetTime: number) => {
    if (kind === 'video') {
      const clip = project.videoClips.find((c) => c.id === clipId);
      if (!clip) return;
      const spd = Math.max(0.25, clip.speed);
      const clipEnd = clip.startTime + clip.duration / spd;
      if (targetTime <= clip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;
      const keepSourceDur = Math.max(0.15, (targetTime - clip.startTime) * spd);
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === clip.id ? { ...c, duration: Number(keepSourceDur.toFixed(2)) } : c
        ),
      });
      setCutAnchor(null);
      return;
    }

    const aclip = project.audioClips.find((a) => a.id === clipId);
    if (!aclip) return;
    const spd = Math.max(0.25, aclip.speed);
    const clipEnd = aclip.startTime + aclip.duration / spd;
    if (targetTime <= aclip.startTime + 0.05 || targetTime >= clipEnd - 0.05) return;
    const keepSourceDur = Math.max(0.15, (targetTime - aclip.startTime) * spd);
    onUpdateProject({
      ...project,
      audioClips: project.audioClips.map((a) =>
        a.id === aclip.id ? { ...a, duration: Number(keepSourceDur.toFixed(2)) } : a
      ),
    });
    setCutAnchor(null);
  };

  const splitSelectedClipAtPlayhead = () => {
    if (selectedClip) {
      splitClipAtTime('video', selectedClip.id, currentTime);
      return;
    }
    if (selectedAudioClip) {
      splitClipAtTime('audio', selectedAudioClip.id, currentTime);
    }
  };

  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = timelineDragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(dx) <= 5) return;
    drag.moved = true;
    const dt = (dx / Math.max(120, drag.trackWidthPx)) * totalDuration;

    if (drag.kind === 'video') {
      if (drag.mode === 'trim-right') {
        const spd = Math.max(0.25, drag.speed);
        const maxAvail = Math.max(0.2, drag.sourceDuration - drag.origTrimStart);
        const nextDuration = Number(
          Math.max(0.2, Math.min(maxAvail, drag.origDuration + dt * spd)).toFixed(2)
        );
        onUpdateProject({
          ...project,
          videoClips: project.videoClips.map((c) =>
            c.id === drag.clipId ? { ...c, duration: nextDuration } : c
          ),
        });
        return;
      }
      const nextStart = Number(Math.max(0, drag.origStartTime + dt).toFixed(2));
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId ? { ...c, startTime: nextStart } : c
        ),
      });
      return;
    }

    // Audio move or drag-to-trim
    if (drag.mode === 'move') {
      const nextStart = Number(Math.max(0, drag.origStartTime + dt).toFixed(2));
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((a) =>
          a.id === drag.clipId ? { ...a, startTime: nextStart } : a
        ),
      });
    } else if (drag.mode === 'trim-left') {
      const spd = Math.max(0.25, drag.speed);
      const minDt = Math.max(-drag.origStartTime, -drag.origTrimStart / spd);
      const maxDt = Math.max(minDt, (drag.origDuration - 0.2) / spd);
      const clampedDt = Math.max(minDt, Math.min(maxDt, dt));
      const nextStart = Number((drag.origStartTime + clampedDt).toFixed(2));
      const nextTrimStart = Number(Math.max(0, drag.origTrimStart + clampedDt * spd).toFixed(2));
      const nextDuration = Number(Math.max(0.2, drag.origDuration - clampedDt * spd).toFixed(2));
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((a) =>
          a.id === drag.clipId
            ? { ...a, startTime: nextStart, trimStart: nextTrimStart, duration: nextDuration }
            : a
        ),
      });
    } else if (drag.mode === 'trim-right') {
      const spd = Math.max(0.25, drag.speed);
      const maxAvail = Math.max(0.2, drag.sourceDuration - drag.origTrimStart);
      const nextDuration = Number(
        Math.max(0.2, Math.min(maxAvail, drag.origDuration + dt * spd)).toFixed(2)
      );
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((a) =>
          a.id === drag.clipId ? { ...a, duration: nextDuration } : a
        ),
      });
    }
  };

  const handleTimelinePointerUp = () => {
    const drag = timelineDragRef.current;
    if (drag.active && !drag.moved && drag.mode === 'move') {
      setIsPlaying(false);
      setCurrentTime(drag.clickTime);
      setCutAnchor({
        kind: drag.kind,
        clipId: drag.clipId,
        track: drag.track,
        time: drag.clickTime,
      });
    }
    timelineDragRef.current.active = false;
  };

  const visualMedia = mediaFiles.filter((m) => m.kind === 'video' || m.kind === 'image');
  const audioMedia = mediaFiles.filter((m) => m.kind === 'audio');
  const aspectLabel = getAspectLabel(project.width, project.height);

  return (
    <div className="max-w-[1600px] mx-auto pl-10 pr-2.5 sm:pl-11 sm:pr-4 py-2.5 pb-20 lg:pb-6 space-y-2.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          void handleDirectMediaImport(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Toolbar */}
      <div className="rounded-xl bg-[#13161D] border border-white/8 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h1 className="text-xs sm:text-sm font-bold text-white leading-tight">Editor de Vídeo Multipista</h1>
            <p className="text-[10px] text-slate-400 font-mono tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(totalDuration)}
            </p>
          </div>
          <span
            className="rounded bg-[#1A1E28] border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300 font-mono"
            title="Proporção e Resolução do Projeto"
          >
            {aspectLabel} · {project.width}×{project.height}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={splitSelectedClipAtPlayhead}
            disabled={!selectedClip && !selectedAudioClip}
            className="h-7 px-2 rounded-md bg-[#1A1E28] hover:bg-white/10 disabled:opacity-40 text-[11px] font-medium text-cyan-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <Scissors className="w-3 h-3" />
            Dividir
          </button>
          <button
            type="button"
            onClick={() => duplicateSelectedClip(false)}
            disabled={!selectedClip && !selectedAudioClip}
            className="h-7 px-2 rounded-md bg-[#1A1E28] hover:bg-white/10 disabled:opacity-40 text-[11px] font-medium text-amber-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            Duplicar
          </button>
          <button
            type="button"
            onClick={deleteSelectedFromTimeline}
            disabled={!selectedClip && !selectedAudioClip}
            className="h-7 px-2 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 disabled:opacity-40 text-[11px] font-medium text-red-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Apagar
          </button>
          <button
            onClick={async () => {
              await onSaveProject();
              setSaveLabel('Salvo!');
              window.setTimeout(() => setSaveLabel(null), 2000);
            }}
            className="h-7 px-2.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <Save className="w-3 h-3" />
            {saveLabel || 'Salvar'}
          </button>
          {onOpenExport && (
            <button
              type="button"
              onClick={async () => {
                await onSaveProject();
                onOpenExport();
              }}
              className="h-7 px-2.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              Exportar
            </button>
          )}
        </div>
      </div>

      {/* Main Split: Media Bin + Preview Monitor + Clip Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-[245px_1fr_275px] gap-2.5 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold text-slate-300">Mídia & Áudio</h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-6 px-2 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3 h-3" />
              Importar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setMediaBinTab('visual')}
              className={`h-7 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1 cursor-pointer ${
                mediaBinTab === 'visual'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-[#1A1E28] text-slate-300'
              }`}
            >
              <Film className="w-3 h-3" />
              Vídeos/Img ({visualMedia.length})
            </button>
            <button
              type="button"
              onClick={() => setMediaBinTab('audio')}
              className={`h-7 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1 cursor-pointer ${
                mediaBinTab === 'audio'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-[#1A1E28] text-slate-300'
              }`}
            >
              <Music className="w-3 h-3" />
              Áudio ({audioMedia.length})
            </button>
          </div>

          {mediaBinTab === 'visual' ? (
            <>
              {/* Painel Retrátil de Sobreposição */}
              <div className="rounded-lg bg-[#0F1218] border border-cyan-500/25 overflow-hidden">
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setOverlayPanelOpen((v) => !v)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[11px] font-semibold text-cyan-200 hover:text-white cursor-pointer"
                    aria-expanded={overlayPanelOpen}
                    title={overlayPanelOpen ? 'Retrair painel de sobreposição' : 'Abrir painel de sobreposição'}
                  >
                    {overlayPanelOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    )}
                    <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">
                      Sobreposição ({project.videoClips.filter((c) => c.track === 'overlay').length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverlayPanelOpen(true);
                      importTargetTrackRef.current = 'overlay';
                      fileInputRef.current?.click();
                    }}
                    className="h-5 px-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/40 text-[10px] font-bold text-cyan-200 inline-flex items-center gap-0.5 cursor-pointer shrink-0"
                    title="Adicionar mídia na sobreposição"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>

                {overlayPanelOpen && (
                  <div className="px-2 pb-2 pt-1 border-t border-white/8 space-y-1.5">
                    <div className="grid grid-cols-1 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          importTargetTrackRef.current = 'overlay';
                          fileInputRef.current?.click();
                        }}
                        className="w-full h-7 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[11px] font-semibold text-cyan-200 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Layers className="w-3 h-3" />+ Criar Sobreposição
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOverlayTrackOpen(true);
                          addOverlayTextClip();
                        }}
                        className="w-full h-7 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-[11px] font-semibold text-amber-300 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Type className="w-3 h-3" />+ Texto / Legenda
                      </button>
                    </div>
                    {project.videoClips.some((c) => c.track === 'overlay') && (
                      <div className="max-h-24 overflow-y-auto space-y-1 pt-0.5">
                        {project.videoClips
                          .filter((c) => c.track === 'overlay')
                          .map((ov) => (
                            <div
                              key={ov.id}
                              onClick={() => {
                                setSelectedClipId(ov.id);
                                setSelectedAudioClipId(null);
                                setCurrentTime(ov.startTime);
                              }}
                              className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[10px] border cursor-pointer ${
                                selectedClipId === ov.id
                                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-100'
                                  : 'bg-[#1A1E28] border-white/5 text-slate-300 hover:border-cyan-500/30'
                              }`}
                            >
                              <span className="truncate flex-1">{ov.name}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateProject({
                                    ...project,
                                    videoClips: project.videoClips.filter((c) => c.id !== ov.id),
                                  });
                                  if (selectedClipId === ov.id) setSelectedClipId(null);
                                  if (cutAnchor?.clipId === ov.id) setCutAnchor(null);
                                }}
                                className="p-0.5 text-slate-400 hover:text-red-400 cursor-pointer shrink-0"
                                title="Apagar sobreposição"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {visualMedia.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Clique em Importar ou Criar Sobreposição acima para adicionar MP4, GIF ou imagens.
                  </p>
                ) : (
                  visualMedia.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg bg-[#1A1E28] border border-white/5 p-2 space-y-2"
                    >
                      <div className="flex items-center gap-2.5">
                        {m.thumbnailDataUrl ? (
                          <img
                            src={m.thumbnailDataUrl}
                            alt={m.name}
                            className="w-10 h-10 rounded object-cover shrink-0"
                          />
                        ) : m.kind === 'video' ? (
                          <Film className="w-5 h-5 text-amber-400 shrink-0" />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-cyan-400 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white truncate">{m.name}</p>
                          <p className="text-[10px] font-mono text-slate-400">
                            {m.kind === 'video' ? formatDuration(m.duration) : '4.0s'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDeleteMedia([m.id]);
                          }}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/15 transition-colors cursor-pointer shrink-0"
                          title="Apagar arquivo adicionado"
                          aria-label={`Apagar ${m.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => appendClipFromMedia(m, 'video')}
                          className="min-h-[28px] px-2 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-[10px] font-semibold text-amber-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          Vídeo Principal
                        </button>
                        <button
                          type="button"
                          onClick={() => appendClipFromMedia(m, 'overlay')}
                          className="min-h-[28px] px-2 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-[10px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Layers className="w-3 h-3" />
                          Sobreposição
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-7 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Music className="w-3 h-3" />+ Importar Áudio (MP3/WAV/M4A)
              </button>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {audioMedia.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Importe músicas ou efeitos sonoros MP3/WAV/AAC/OGG acima para adicionar ao vídeo.
                  </p>
                ) : (
                  audioMedia.map((m) => (
                    <div
                      key={m.id}
                      className="w-full flex items-center gap-1 rounded-lg bg-[#1A1E28] hover:border-emerald-500/30 border border-white/5 p-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => void appendAudioClipFromMedia(m)}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer hover:opacity-90"
                      >
                        <Music className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-white truncate">{m.name}</p>
                          <p className="text-[10px] font-mono text-slate-400">
                            + Adicionar {formatDuration(m.duration)}
                          </p>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteMedia([m.id]);
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/15 transition-colors cursor-pointer shrink-0"
                        title="Apagar áudio adicionado"
                        aria-label={`Apagar ${m.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Added files currently inside the active composition */}
          <div className="pt-2 border-t border-white/8 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Na Composição ({project.videoClips.length + project.audioClips.length})
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {project.videoClips.length === 0 && project.audioClips.length === 0 ? (
                <p className="text-[10px] text-slate-500 py-2 text-center">
                  Nenhum arquivo adicionado na composição.
                </p>
              ) : (
                <>
                  {project.videoClips.map((clip) => {
                    const active = selectedClipId === clip.id;
                    return (
                      <div
                        key={clip.id}
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setSelectedAudioClipId(null);
                        }}
                        className={`flex items-center justify-between gap-1.5 rounded-md px-2 py-1 text-[11px] border cursor-pointer ${
                          active
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                            : 'bg-[#1A1E28] border-white/5 text-slate-300 hover:border-white/15'
                        }`}
                      >
                        <span className="truncate flex-1">
                          {clip.track === 'overlay' ? 'Sobr.' : 'Princ.'} · {clip.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateProject({
                              ...project,
                              videoClips: project.videoClips.filter((c) => c.id !== clip.id),
                            });
                            if (selectedClipId === clip.id) setSelectedClipId(null);
                            if (cutAnchor?.clipId === clip.id) setCutAnchor(null);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/15 cursor-pointer shrink-0"
                          title="Apagar da composição"
                          aria-label={`Apagar ${clip.name} da composição`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {project.audioClips.map((aclip) => {
                    const active = selectedAudioClipId === aclip.id;
                    return (
                      <div
                        key={aclip.id}
                        onClick={() => {
                          setSelectedAudioClipId(aclip.id);
                          setSelectedClipId(null);
                        }}
                        className={`flex items-center justify-between gap-1.5 rounded-md px-2 py-1 text-[11px] border cursor-pointer ${
                          active
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                            : 'bg-[#1A1E28] border-white/5 text-slate-300 hover:border-white/15'
                        }`}
                      >
                        <span className="truncate flex-1">Áudio · {aclip.name}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateProject({
                              ...project,
                              audioClips: project.audioClips.filter((a) => a.id !== aclip.id),
                            });
                            if (selectedAudioClipId === aclip.id) setSelectedAudioClipId(null);
                            if (cutAnchor?.clipId === aclip.id) setCutAnchor(null);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/15 cursor-pointer shrink-0"
                          title="Apagar áudio da composição"
                          aria-label={`Apagar ${aclip.name} da composição`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center Video Monitor (Touch + Mouse Drag / Resize / Rotate) + Stage Resolutions */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400">
              Palco ({aspectLabel} · {project.width}×{project.height})
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Controles de Zoom do Player (Touch Pinch/Duplo Toque + Botões) */}
              <div
                className="flex items-center gap-0.5 bg-[#0B0D11] border border-white/10 rounded-md p-0.5"
                role="group"
                aria-label="Zoom do Player de Vídeo"
              >
                <button
                  type="button"
                  onClick={() => stageZoom.setZoomEnabled((v) => !v)}
                  className={`h-6 px-1.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                    stageZoom.zoomEnabled
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:bg-white/10'
                  }`}
                  title="Ativar ou desativar zoom por toque na tela"
                >
                  <ZoomIn className="w-3 h-3" />
                  <span>Zoom</span>
                </button>
                <button
                  type="button"
                  onClick={() => stageZoom.zoomByStep(-1)}
                  disabled={stageZoom.zoom <= 1}
                  className="h-6 w-6 rounded text-slate-300 hover:bg-white/10 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
                  title="Reduzir zoom"
                  aria-label="Reduzir zoom"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono text-amber-300 min-w-[36px] text-center">
                  {Math.round(stageZoom.zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => stageZoom.zoomByStep(1)}
                  disabled={stageZoom.zoom >= 5}
                  className="h-6 w-6 rounded text-slate-300 hover:bg-white/10 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
                  title="Aumentar zoom"
                  aria-label="Aumentar zoom"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                {stageZoom.zoom > 1.01 && (
                  <button
                    type="button"
                    onClick={stageZoom.resetZoom}
                    className="h-6 px-1.5 rounded text-[10px] font-semibold text-slate-200 bg-white/10 hover:bg-white/20 inline-flex items-center gap-0.5 cursor-pointer"
                    title="Voltar ao tamanho original (100%)"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>1:1</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setEdgeStretchEnabled((v) => !v);
                  setHoverEdge(null);
                  setHoverCursor(null);
                }}
                className={`h-6 px-2 rounded text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  edgeStretchEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-[#1A1E28] text-slate-400 hover:bg-white/10'
                }`}
                title="Ativar ou desativar alças de esticar ao passar o mouse na borda/final da imagem"
              >
                <MoveHorizontal className="w-3 h-3" />
                <span>Esticar</span>
              </button>

              <div className="flex items-center gap-1" role="group" aria-label="Resoluções do Palco">
                {STAGE_RESOLUTIONS.map((preset) => {
                  const isSelectedRes =
                    project.width === preset.width && project.height === preset.height;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        stageZoom.resetZoom();
                        onUpdateProject(resizeProjectDimensions(project, preset.width, preset.height));
                      }}
                      className={`h-6 px-2 rounded text-[10px] font-mono font-semibold cursor-pointer ${
                        isSelectedRes
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-[#1A1E28] text-slate-300 hover:bg-white/10'
                      }`}
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            ref={stageViewportRef}
            className="w-full rounded-lg bg-[#0B0D11] border border-white/10 overflow-hidden relative touch-none select-none"
          >
            <div
              style={{
                transform: `translate(${stageZoom.pan.x}px, ${stageZoom.pan.y}px) scale(${stageZoom.zoom})`,
                transformOrigin: '0 0',
              }}
              className="w-full p-1.5 flex items-center justify-center will-change-transform"
            >
              <canvas
                ref={canvasRef}
                width={project.width}
                height={project.height}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onPointerLeave={() => {
                  if (!canvasDragRef.current.active) {
                    setHoverEdge(null);
                    setHoverCursor(null);
                  }
                }}
                style={hoverCursor ? { cursor: hoverCursor } : undefined}
                className="max-h-[340px] sm:max-h-[370px] w-auto max-w-full h-auto mx-auto block touch-none select-none cursor-grab active:cursor-grabbing"
              />
            </div>
            {stageZoom.zoom > 1.01 && (
              <button
                type="button"
                onClick={stageZoom.resetZoom}
                className="absolute top-2 right-2 rounded bg-black/75 hover:bg-black border border-cyan-400/40 px-2 py-0.5 text-[10px] font-mono text-cyan-200 shadow cursor-pointer"
                title="Clique para resetar zoom"
              >
                {Math.round(stageZoom.zoom * 100)}% · Resetar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="h-5 px-2 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
              {isPlaying ? 'PAUSAR' : 'PLAY'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTime(0);
              }}
              className="h-5 px-2 rounded bg-[#1A1E28] hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              STOP
            </button>
          </div>
          <div className="text-[10px] text-slate-400 px-1 flex flex-wrap items-center justify-between gap-1.5">
            <span>
              Arraste com o dedo ou mouse · Pinça/duplo toque ou botões +/- dão zoom
            </span>
            {selectedClip && (
              <span className="font-mono text-amber-300">
                X:{selectedClip.x} Y:{selectedClip.y} · {selectedClip.scale.toFixed(2)}×
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-mono text-slate-400 w-10">
              {currentTime.toFixed(1)}s
            </span>
            <input
              type="range"
              min={0}
              max={totalDuration}
              step={0.05}
              value={currentTime}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentTime(Number(e.target.value));
              }}
              className="flex-1 accent-amber-500"
            />
            <span className="text-[10px] font-mono text-slate-400 w-10 text-right">
              {totalDuration.toFixed(1)}s
            </span>
          </div>
        </div>

        {/* Right Clip / Audio Inspector */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-2.5 space-y-2.5 max-h-[540px] overflow-y-auto">
          {/* Barra Retrátil de Sobreposição no lado direito */}
          <div className="rounded-lg bg-[#0F1218] border border-cyan-500/25 overflow-hidden">
            <div className="flex items-center justify-between gap-1 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setRightOverlayPanelOpen((v) => !v)}
                className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[11px] font-semibold text-cyan-200 hover:text-white cursor-pointer"
                aria-expanded={rightOverlayPanelOpen}
                title={
                  rightOverlayPanelOpen
                    ? 'Retrair arquivos da sobreposição'
                    : 'Expandir arquivos da sobreposição'
                }
              >
                {rightOverlayPanelOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                )}
                <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">
                  Sobreposição ({project.videoClips.filter((c) => c.track === 'overlay').length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRightOverlayPanelOpen(true);
                  importTargetTrackRef.current = 'overlay';
                  fileInputRef.current?.click();
                }}
                className="h-5 px-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/40 text-[10px] font-bold text-cyan-200 inline-flex items-center gap-0.5 cursor-pointer shrink-0"
                title="Adicionar arquivo na sobreposição"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            </div>

            {rightOverlayPanelOpen && (
              <div className="px-2 pb-2 pt-1.5 border-t border-white/8 space-y-1.5">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      importTargetTrackRef.current = 'overlay';
                      fileInputRef.current?.click();
                    }}
                    className="h-6 px-2 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[10px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Layers className="w-3 h-3" />+ Sobreposição
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverlayTrackOpen(true);
                      addOverlayTextClip();
                    }}
                    className="h-6 px-2 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-[10px] font-semibold text-amber-300 inline-flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Type className="w-3 h-3" />+ Legenda
                  </button>
                </div>

                {project.videoClips.some((c) => c.track === 'overlay') ? (
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {project.videoClips
                      .filter((c) => c.track === 'overlay')
                      .map((ov) => (
                        <div
                          key={ov.id}
                          onClick={() => {
                            setSelectedClipId(ov.id);
                            setSelectedAudioClipId(null);
                            setCurrentTime(ov.startTime);
                            setRightOverlayInspectorOpen(true);
                          }}
                          className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-[10px] border cursor-pointer ${
                            selectedClipId === ov.id
                              ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-100'
                              : 'bg-[#1A1E28] border-white/5 text-slate-300 hover:border-cyan-500/30'
                          }`}
                        >
                          <span className="truncate flex-1">{ov.name}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateProject({
                                ...project,
                                videoClips: project.videoClips.filter((c) => c.id !== ov.id),
                              });
                              if (selectedClipId === ov.id) setSelectedClipId(null);
                              if (cutAnchor?.clipId === ov.id) setCutAnchor(null);
                            }}
                            className="p-0.5 text-slate-400 hover:text-red-400 cursor-pointer shrink-0"
                            title="Apagar sobreposição"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 text-center py-1">
                    Nenhum arquivo na sobreposição.
                  </p>
                )}
              </div>
            )}
          </div>

          {selectedAudioClip ? (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-white/8">
                <h3 className="text-xs font-semibold text-emerald-300 truncate flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5" />
                  {selectedAudioClip.name}
                </h3>
                <button
                  onClick={() => {
                    onUpdateProject({
                      ...project,
                      audioClips: project.audioClips.filter((a) => a.id !== selectedAudioClip.id),
                    });
                    setSelectedAudioClipId(null);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                Arraste as bordas esquerda/direita na pista de áudio abaixo para cortar ou ajuste o ponto exato aqui:
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Início na Pista (s)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedAudioClip.startTime}
                    onChange={(e) =>
                      updateSelectedAudioClip({ startTime: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Duração Cortada (s)</label>
                  <input
                    type="number"
                    min={0.2}
                    max={Math.max(0.2, selectedAudioClip.sourceDuration - selectedAudioClip.trimStart)}
                    step={0.1}
                    value={selectedAudioClip.duration}
                    onChange={(e) => {
                      const maxAvail = Math.max(
                        0.2,
                        selectedAudioClip.sourceDuration - selectedAudioClip.trimStart
                      );
                      updateSelectedAudioClip({
                        duration: Number(
                          Math.max(0.2, Math.min(maxAvail, Number(e.target.value))).toFixed(2)
                        ),
                      });
                    }}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Corte Início (s)</label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, selectedAudioClip.sourceDuration - 0.2)}
                    step={0.1}
                    value={selectedAudioClip.trimStart}
                    onChange={(e) => {
                      const nextTrim = Math.max(
                        0,
                        Math.min(selectedAudioClip.sourceDuration - 0.2, Number(e.target.value))
                      );
                      const maxDur = Math.max(0.2, selectedAudioClip.sourceDuration - nextTrim);
                      updateSelectedAudioClip({
                        trimStart: Number(nextTrim.toFixed(2)),
                        duration: Number(Math.min(selectedAudioClip.duration, maxDur).toFixed(2)),
                      });
                    }}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Corte Fim (s)</label>
                  <input
                    type="number"
                    min={selectedAudioClip.trimStart + 0.2}
                    max={selectedAudioClip.sourceDuration}
                    step={0.1}
                    value={Number(
                      Math.min(
                        selectedAudioClip.sourceDuration,
                        selectedAudioClip.trimStart + selectedAudioClip.duration
                      ).toFixed(2)
                    )}
                    onChange={(e) => {
                      const targetEnd = Math.max(
                        selectedAudioClip.trimStart + 0.2,
                        Math.min(selectedAudioClip.sourceDuration, Number(e.target.value))
                      );
                      updateSelectedAudioClip({
                        duration: Number((targetEnd - selectedAudioClip.trimStart).toFixed(2)),
                      });
                    }}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Volume (Ganho)</span>
                  <span className="font-mono text-white">
                    {Math.round(selectedAudioClip.gain * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedAudioClip.gain}
                  onChange={(e) => updateSelectedAudioClip({ gain: Number(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Velocidade</span>
                  <span className="font-mono text-white">{selectedAudioClip.speed}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={selectedAudioClip.speed}
                  onChange={(e) => updateSelectedAudioClip({ speed: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <button
                type="button"
                onClick={() => updateSelectedAudioClip({ muted: !selectedAudioClip.muted })}
                className={`w-full min-h-[38px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer ${
                  selectedAudioClip.muted
                    ? 'bg-red-500/20 border border-red-500/40 text-red-300'
                    : 'bg-[#1A1E28] border border-white/10 text-slate-200'
                }`}
              >
                {selectedAudioClip.muted ? (
                  <>
                    <VolumeX className="w-4 h-4" /> Áudio Silenciado (Ativar)
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 text-emerald-400" /> Silenciar Áudio
                  </>
                )}
              </button>
            </>
          ) : selectedClip ? (
            selectedClip.track === 'overlay' && !rightOverlayInspectorOpen ? (
              <button
                type="button"
                onClick={() => setRightOverlayInspectorOpen(true)}
                className="w-full flex items-center justify-between gap-2 rounded-lg bg-[#0F1218] border border-cyan-500/30 hover:border-cyan-400/50 px-2.5 py-2 text-left cursor-pointer"
                aria-expanded={false}
                title="Expandir ajustes da sobreposição"
              >
                <span className="text-xs font-semibold text-cyan-200 truncate flex items-center gap-1.5 min-w-0">
                  <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{selectedClip.name}</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 shrink-0">
                  Sobreposição · Abrir
                </span>
              </button>
            ) : (
            <>
              <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-white/8">
                <h3 className="text-xs font-semibold text-white truncate flex items-center gap-1.5 min-w-0">
                  <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{selectedClip.name}</span>
                </h3>
                {selectedClip.track === 'overlay' ? (
                  <button
                    type="button"
                    onClick={() => setRightOverlayInspectorOpen(false)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-200 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    aria-expanded={true}
                    title="Retrair ajustes da sobreposição"
                  >
                    <ChevronDown className="w-3 h-3" />
                    <span>Sobreposição</span>
                  </button>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0B0D11] text-slate-300 shrink-0">
                    Vídeo Principal
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => duplicateSelectedClip(true)}
                  className="h-7 px-2 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-[10px] font-semibold text-amber-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3 shrink-0" />
                  Duplicar Principal
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedFromTimeline}
                  className="h-7 px-2 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/35 text-[10px] font-semibold text-red-300 inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  Apagar Clipe
                </button>
              </div>

              {selectedClip.track !== 'video' ? (
                <button
                  type="button"
                  onClick={insertSelectedIntoMainVideoTrack}
                  className="w-full h-7 px-2.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[10px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <ArrowDownToLine className="w-3 h-3 shrink-0" />
                  Inserir no Vídeo Principal
                </button>
              ) : (
                <button
                  type="button"
                  onClick={createOverlayFromSelected}
                  className="w-full h-7 px-2.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[10px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Layers className="w-3 h-3 shrink-0" />
                  Criar Sobreposição deste Vídeo
                </button>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Posição X</label>
                  <input
                    type="number"
                    value={selectedClip.x}
                    onChange={(e) => updateSelectedClip({ x: Number(e.target.value) })}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Posição Y</label>
                  <input
                    type="number"
                    value={selectedClip.y}
                    onChange={(e) => updateSelectedClip({ y: Number(e.target.value) })}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Início (s)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedClip.startTime}
                    onChange={(e) =>
                      updateSelectedClip({ startTime: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Duração (s)</label>
                  <input
                    type="number"
                    min={0.2}
                    step={0.1}
                    value={selectedClip.duration}
                    onChange={(e) =>
                      updateSelectedClip({ duration: Math.max(0.2, Number(e.target.value)) })
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Velocidade</span>
                  <span className="font-mono text-white">{selectedClip.speed}×</span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={3}
                  step={0.25}
                  value={selectedClip.speed}
                  onChange={(e) => updateSelectedClip({ speed: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between items-center text-[11px] text-slate-400 mb-1">
                  <span>Escala</span>
                  <div className="flex items-center gap-1.5">
                    {(selectedClip.scaleX !== undefined &&
                      selectedClip.scaleY !== undefined &&
                      Math.abs(selectedClip.scaleX - selectedClip.scaleY) > 0.02) && (
                      <button
                        type="button"
                        onClick={() => {
                          const base = Number(
                            (((selectedClip.scaleX ?? selectedClip.scale) + (selectedClip.scaleY ?? selectedClip.scale)) / 2).toFixed(2)
                          );
                          updateSelectedClip({ scale: base, scaleX: base, scaleY: base });
                        }}
                        className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] hover:bg-emerald-500/25 cursor-pointer"
                        title="Igualar largura e altura"
                      >
                        1:1
                      </button>
                    )}
                    <span className="font-mono text-white">
                      {selectedClip.scaleX !== undefined &&
                      selectedClip.scaleY !== undefined &&
                      Math.abs(selectedClip.scaleX - selectedClip.scaleY) > 0.02
                        ? `${selectedClip.scaleX.toFixed(2)}×${selectedClip.scaleY.toFixed(2)}`
                        : `${selectedClip.scale.toFixed(2)}×`}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={selectedClip.scale}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateSelectedClip({ scale: val, scaleX: val, scaleY: val });
                  }}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Volume2 className="w-3 h-3" /> Volume / Opacidade
                  </span>
                  <span className="font-mono text-white">
                    {Math.round(selectedClip.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedClip.opacity}
                  onChange={(e) => updateSelectedClip({ opacity: Number(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Transição</label>
                <select
                  value={selectedClip.transition}
                  onChange={(e) =>
                    updateSelectedClip({
                      transition: e.target.value as VideoClip['transition'],
                    })
                  }
                  className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-2 text-xs text-white"
                >
                  <option value="none">Corte Direto</option>
                  <option value="fade-in">Fade In</option>
                  <option value="fade-out">Fade Out</option>
                  <option value="fade-both">Fade In + Fade Out</option>
                </select>
              </div>

              {(selectedClip.kind === 'image' || selectedClip.kind === 'video') && (
                <div className="rounded-lg bg-[#0B0D11]/80 border border-emerald-500/25 p-2.5 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedClip.chromaKey?.enabled ?? false}
                      onChange={(e) =>
                        updateSelectedClip({
                          chromaKey: {
                            ...(selectedClip.chromaKey || DEFAULT_CHROMA_KEY),
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="accent-emerald-500 w-4 h-4"
                    />
                    Chroma Key (Remover Fundo)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedClip.chromaKey?.keyColor || '#00FF00'}
                      onChange={(e) =>
                        updateSelectedClip({
                          chromaKey: {
                            ...(selectedClip.chromaKey || DEFAULT_CHROMA_KEY),
                            enabled: true,
                            keyColor: e.target.value,
                          },
                        })
                      }
                      className="w-8 h-7 rounded bg-transparent cursor-pointer"
                    />
                    {['#00FF00', '#0000FF', '#FFFFFF', '#000000'].map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() =>
                          updateSelectedClip({
                            chromaKey: {
                              ...(selectedClip.chromaKey || DEFAULT_CHROMA_KEY),
                              enabled: true,
                              keyColor: hex,
                            },
                          })
                        }
                        style={{ backgroundColor: hex }}
                        className="w-6 h-6 rounded border border-white/25 cursor-pointer"
                        title={`Cor ${hex}`}
                      />
                    ))}
                  </div>
                  {selectedClip.chromaKey?.enabled && (
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Similaridade</span>
                        <span className="font-mono text-white">
                          {selectedClip.chromaKey.similarity}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={95}
                        value={selectedClip.chromaKey.similarity}
                        onChange={(e) =>
                          updateSelectedClip({
                            chromaKey: {
                              ...(selectedClip.chromaKey || DEFAULT_CHROMA_KEY),
                              similarity: Number(e.target.value),
                            },
                          })
                        }
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
            )
          ) : (
            <p className="text-xs text-slate-400 py-10 text-center">
              Toque ou clique em um vídeo, imagem ou áudio na linha do tempo ou no palco para editar.
            </p>
          )}
        </div>
      </div>

      {/* Multi-Track Retractable Aerial Timeline (40px tracks) */}
      <AerialTimeline
        title="Linha do Tempo Multipista"
        subtitle={`${formatDuration(currentTime)} / ${formatDuration(totalDuration)}`}
        headerExtra={
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setOverlayTrackOpen((v) => !v)}
              className={`h-5 px-2 rounded text-[10px] font-semibold inline-flex items-center gap-1 border cursor-pointer ${
                overlayTrackOpen
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                  : 'bg-[#1A1E28] border-white/10 text-slate-300 hover:border-cyan-500/40'
              }`}
              aria-expanded={overlayTrackOpen}
              title={overlayTrackOpen ? 'Retrair trilha de Sobreposição' : 'Expandir trilha de Sobreposição'}
            >
              <Layers className="w-2.5 h-2.5 text-cyan-400" />
              <span>
                Sobreposição ({project.videoClips.filter((c) => c.track === 'overlay').length})
              </span>
              {overlayTrackOpen ? (
                <ChevronDown className="w-2.5 h-2.5" />
              ) : (
                <ChevronRight className="w-2.5 h-2.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="h-5 px-2 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
              title={isPlaying ? 'Pausar reprodução' : 'Reproduzir linha do tempo'}
            >
              {isPlaying ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
              {isPlaying ? 'PAUSAR' : 'PLAY'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTime(0);
              }}
              className="h-5 px-2 rounded bg-[#1A1E28] hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
              title="Parar e voltar ao início"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              STOP
            </button>
          </div>
        }
      >
        <div
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
          className="space-y-1.5 overflow-x-hidden"
        >
          {/* Floating / Anchored Cut Menu right at the clicked spot on video or audio */}
          {cutAnchor && (
            <div className="w-full relative h-8">
              <div
                style={{
                  left: `${Math.max(0, Math.min(28, (cutAnchor.time / totalDuration) * 100))}%`,
                }}
                className="absolute top-0 inline-flex items-center gap-1 rounded-lg bg-[#1A1E28] border border-rose-400/60 shadow-lg px-2 py-1 z-30 max-w-full"
              >
                <span className="text-[10px] font-mono font-bold text-rose-300 inline-flex items-center gap-1 shrink-0">
                  <Scissors className="w-3 h-3" />
                  {cutAnchor.time.toFixed(1)}s
                </span>
                <button
                  type="button"
                  onClick={() => splitClipAtTime(cutAnchor.kind, cutAnchor.clipId, cutAnchor.time)}
                  className="h-5 px-1.5 rounded bg-rose-500 hover:bg-rose-400 text-[10px] font-bold text-white inline-flex items-center gap-1 cursor-pointer shrink-0"
                  title="Cortar e dividir em 2 partes neste ponto"
                >
                  <Scissors className="w-2.5 h-2.5" />
                  Cortar
                </button>
                <button
                  type="button"
                  onClick={() => trimClipBeforeTime(cutAnchor.kind, cutAnchor.clipId, cutAnchor.time)}
                  className="h-5 px-1.5 rounded bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-[10px] font-medium text-amber-300 cursor-pointer shrink-0"
                  title="Cortar fora a parte antes deste ponto"
                >
                  Cortar Início
                </button>
                <button
                  type="button"
                  onClick={() => trimClipAfterTime(cutAnchor.kind, cutAnchor.clipId, cutAnchor.time)}
                  className="h-5 px-1.5 rounded bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-[10px] font-medium text-amber-300 cursor-pointer shrink-0"
                  title="Cortar fora a parte depois deste ponto"
                >
                  Cortar Fim
                </button>
                <button
                  type="button"
                  onClick={() => duplicateSelectedClip(false)}
                  className="h-5 px-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-semibold text-amber-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Copy className="w-2.5 h-2.5" />
                  Duplicar
                </button>
                {cutAnchor.kind === 'video' && selectedClip && (
                  <>
                    <button
                      type="button"
                      onClick={insertSelectedIntoMainVideoTrack}
                      className="h-5 px-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-[10px] font-semibold text-cyan-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <ArrowDownToLine className="w-2.5 h-2.5" />
                      {selectedClip.track === 'video' ? 'Dup. Principal' : 'Principal'}
                    </button>
                    <button
                      type="button"
                      onClick={createOverlayFromSelected}
                      className="h-5 px-1.5 rounded bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-[10px] font-semibold text-purple-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Layers className="w-2.5 h-2.5" />
                      Sobrepor
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={deleteSelectedFromTimeline}
                  className="h-5 px-1.5 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-[10px] font-semibold text-red-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  Apagar
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-5 px-1.5 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer shrink-0"
                  title={isPlaying ? 'Pausar reprodução' : 'Reproduzir a partir deste ponto'}
                >
                  {isPlaying ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                  {isPlaying ? 'PAUSAR' : 'PLAY'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                  className="h-5 px-1.5 rounded bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-[10px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer shrink-0"
                  title="Parar e voltar ao início"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  STOP
                </button>
                <button
                  type="button"
                  onClick={() => setCutAnchor(null)}
                  className="h-5 w-5 rounded text-slate-400 hover:text-white inline-flex items-center justify-center cursor-pointer shrink-0"
                  title="Fechar opções de corte"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {!cutAnchor && (selectedClip || selectedAudioClip) && (
            <div className="rounded-lg bg-[#1A1E28] border border-amber-500/30 px-2.5 py-1 flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-[10px] font-semibold text-white truncate">
                Clique em qualquer parte do vídeo ou áudio na pista para cortar ·{' '}
                <span className="text-amber-300">
                  {selectedClip ? selectedClip.name : selectedAudioClip?.name}
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => duplicateSelectedClip(false)}
                  className="h-5 px-2 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-2.5 h-2.5" />
                  Duplicar
                </button>
                {selectedClip && (
                  <>
                    <button
                      type="button"
                      onClick={insertSelectedIntoMainVideoTrack}
                      className="h-5 px-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-[10px] font-semibold text-cyan-200 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowDownToLine className="w-2.5 h-2.5" />
                      {selectedClip.track === 'video' ? 'Duplicar Principal' : 'Vídeo Principal'}
                    </button>
                    <button
                      type="button"
                      onClick={createOverlayFromSelected}
                      className="h-5 px-2 rounded bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-[10px] font-semibold text-purple-200 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Layers className="w-2.5 h-2.5" />
                      Sobreposição
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={splitSelectedClipAtPlayhead}
                  className="h-5 px-2 rounded bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-[10px] font-medium text-cyan-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Scissors className="w-2.5 h-2.5" />
                  Cortar
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedFromTimeline}
                  className="h-5 px-2 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-[10px] font-semibold text-red-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  Apagar
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-5 px-2 rounded bg-amber-500 hover:bg-amber-400 text-[10px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
                  title={isPlaying ? 'Pausar reprodução' : 'Reproduzir linha do tempo'}
                >
                  {isPlaying ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                  {isPlaying ? 'PAUSAR' : 'PLAY'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                  className="h-5 px-2 rounded bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-[10px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                  title="Parar e voltar ao início"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  STOP
                </button>
              </div>
            </div>
          )}

          {(['overlay', 'video'] as const).map((trackName) => {
            const trackClips = project.videoClips.filter((c) => c.track === trackName);
            if (trackName === 'overlay' && !overlayTrackOpen) {
              return (
                <div key={trackName} className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setOverlayTrackOpen(true)}
                    className="w-20 sm:w-24 text-[10px] font-medium shrink-0 inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 cursor-pointer text-left"
                    title="Expandir trilha de Sobreposição"
                  >
                    <ChevronRight className="w-3 h-3 shrink-0" />
                    <Layers className="w-3 h-3 shrink-0" />
                    <span className="truncate">Sobreposição</span>
                  </button>
                  <div
                    onClick={() => setOverlayTrackOpen(true)}
                    className="flex-1 min-w-0 h-6 rounded-md bg-[#0B0D11]/80 border border-cyan-500/20 hover:border-cyan-400/45 px-2.5 flex items-center justify-between gap-2 text-[10px] text-cyan-300/80 cursor-pointer transition-colors"
                  >
                    <span className="truncate min-w-0">
                      Sobreposição retraída ({trackClips.length} {trackClips.length === 1 ? 'clipe' : 'clipes'}) · Clique para expandir
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverlayTrackOpen(true);
                        importTargetTrackRef.current = 'overlay';
                        fileInputRef.current?.click();
                      }}
                      className="h-4 px-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-[9px] font-bold text-cyan-200 inline-flex items-center gap-0.5 cursor-pointer shrink-0"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      Adicionar
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={trackName} className="flex items-center gap-2 min-w-0">
                {trackName === 'overlay' ? (
                  <button
                    type="button"
                    onClick={() => setOverlayTrackOpen(false)}
                    className="w-20 sm:w-24 text-[10px] font-medium shrink-0 inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 cursor-pointer text-left"
                    title="Retrair trilha de Sobreposição"
                  >
                    <ChevronDown className="w-3 h-3 shrink-0" />
                    <Layers className="w-3 h-3 shrink-0" />
                    <span className="truncate">Sobreposição</span>
                  </button>
                ) : (
                  <span className="w-20 sm:w-24 text-[10px] font-medium shrink-0 inline-flex items-center gap-1 text-slate-300 truncate">
                    Vídeo Principal
                  </span>
                )}
                <div
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                    setIsPlaying(false);
                    setCurrentTime(Number((ratio * totalDuration).toFixed(2)));
                    setCutAnchor(null);
                  }}
                  className={`flex-1 h-10 rounded-md bg-[#0B0D11] border relative overflow-hidden ${
                    trackName === 'overlay' ? 'border-cyan-500/25' : 'border-white/8'
                  }`}
                >
                  {trackName === 'overlay' && trackClips.length === 0 && (
                    <div className="h-full flex items-center px-2.5 text-[10px] text-slate-500 pointer-events-none">
                      Use &ldquo;+ Criar Sobreposição&rdquo; para sobrepor vídeos, GIFs ou imagens
                    </div>
                  )}
                  {trackClips.map((clip) => {
                    const leftPct = (clip.startTime / totalDuration) * 100;
                    const widthPct = Math.max(
                      4,
                      (clip.duration / Math.max(0.25, clip.speed) / totalDuration) * 100
                    );
                    const active = clip.id === selectedClipId;
                    const clipEnd = clip.startTime + clip.duration / Math.max(0.25, clip.speed);
                    const mediaSrc = clip.mediaId ? mediaFiles.find((m) => m.id === clip.mediaId) : undefined;
                    const maxClipSrcDur =
                      clip.kind === 'video' && mediaSrc?.duration
                        ? Math.max(clip.duration, mediaSrc.duration)
                        : 300;
                    return (
                      <div
                        key={clip.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                          setSelectedAudioClipId(null);
                          const trackEl = e.currentTarget.parentElement;
                          const rect = trackEl?.getBoundingClientRect();
                          const rawTime = rect
                            ? ((e.clientX - rect.left) / Math.max(1, rect.width)) * totalDuration
                            : clip.startTime;
                          const safeClickTime = Number(
                            Math.max(clip.startTime, Math.min(clipEnd, rawTime)).toFixed(2)
                          );
                          timelineDragRef.current = {
                            active: true,
                            moved: false,
                            kind: 'video',
                            track: trackName,
                            mode: 'move',
                            clipId: clip.id,
                            startClientX: e.clientX,
                            clickTime: safeClickTime,
                            origStartTime: clip.startTime,
                            origTrimStart: clip.trimStart,
                            origDuration: clip.duration,
                            sourceDuration: maxClipSrcDur,
                            speed: clip.speed,
                            trackWidthPx: rect?.width || 400,
                          };
                        }}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        className={`group/clip absolute top-1 bottom-1 rounded px-1.5 pr-3 flex items-center text-left text-[10px] font-medium border touch-none select-none cursor-pointer ${
                          active
                            ? trackName === 'overlay'
                              ? 'bg-cyan-400 text-slate-950 border-cyan-200 font-bold'
                              : 'bg-amber-500 text-slate-950 border-amber-300 font-bold'
                            : trackName === 'overlay'
                            ? 'bg-cyan-950/75 text-cyan-200 border-cyan-500/35 hover:border-cyan-400'
                            : 'bg-[#1E2534] text-slate-200 border-white/15 hover:border-amber-400/50'
                        }`}
                        title="Clique para cortar, arraste para mover ou passe o mouse no final para esticar duração"
                      >
                        <span className="truncate flex-1 pointer-events-none">{clip.name}</span>
                        {edgeStretchEnabled && (
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setSelectedClipId(clip.id);
                              setSelectedAudioClipId(null);
                              const trackEl = e.currentTarget.parentElement?.parentElement;
                              const rect = trackEl?.getBoundingClientRect();
                              timelineDragRef.current = {
                                active: true,
                                moved: true,
                                kind: 'video',
                                track: trackName,
                                mode: 'trim-right',
                                clipId: clip.id,
                                startClientX: e.clientX,
                                clickTime: clipEnd,
                                origStartTime: clip.startTime,
                                origTrimStart: clip.trimStart,
                                origDuration: clip.duration,
                                sourceDuration: maxClipSrcDur,
                                speed: clip.speed,
                                trackWidthPx: rect?.width || 400,
                              };
                            }}
                            className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize flex items-center justify-center rounded-r bg-emerald-400/0 group-hover/clip:bg-emerald-400/75 hover:!bg-emerald-400 transition-colors"
                            title="Esticar ou encurtar duração no final"
                          >
                            <span className="w-0.5 h-3.5 rounded bg-slate-950/80 opacity-0 group-hover/clip:opacity-100" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cutAnchor && cutAnchor.track === trackName && (
                    <div
                      style={{ left: `${(cutAnchor.time / totalDuration) * 100}%` }}
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-400 pointer-events-none z-20"
                    />
                  )}
                  {/* Playhead line */}
                  <div
                    style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                    className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none"
                  />
                </div>
              </div>
            );
          })}

          {/* Audio Track (40px) */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-20 sm:w-24 text-[10px] font-medium text-emerald-300 shrink-0 inline-flex items-center gap-1">
              <Music className="w-3 h-3 shrink-0" />
              <span className="truncate">Áudio / Música</span>
            </span>
            <div
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                setIsPlaying(false);
                setCurrentTime(Number((ratio * totalDuration).toFixed(2)));
                setCutAnchor(null);
              }}
              className="flex-1 h-10 rounded-md bg-[#0B0D11] border border-emerald-500/20 relative overflow-hidden"
            >
              {project.audioClips.length === 0 ? (
                <div className="h-full flex items-center px-2.5 text-[10px] text-slate-500 pointer-events-none">
                  Use a aba &ldquo;Áudio&rdquo; à esquerda para importar ou adicionar músicas
                </div>
              ) : (
              project.audioClips.map((aclip) => {
                const leftPct = (aclip.startTime / totalDuration) * 100;
                const widthPct = Math.max(
                  4,
                  (aclip.duration / Math.max(0.25, aclip.speed) / totalDuration) * 100
                );
                const active = aclip.id === selectedAudioClipId;
                const srcTotal = Math.max(0.2, aclip.sourceDuration || aclip.duration);
                const clipEnd = aclip.startTime + aclip.duration / Math.max(0.25, aclip.speed);
                const startIdx = Math.floor(
                  (aclip.trimStart / srcTotal) * aclip.peaks.length
                );
                const endIdx = Math.max(
                  startIdx + 4,
                  Math.ceil(((aclip.trimStart + aclip.duration) / srcTotal) * aclip.peaks.length)
                );
                const visiblePeaks = aclip.peaks.slice(
                  Math.max(0, startIdx),
                  Math.min(aclip.peaks.length, endIdx)
                );

                return (
                  <div
                    key={aclip.id}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedAudioClipId(aclip.id);
                      setSelectedClipId(null);
                      const trackEl = e.currentTarget.parentElement;
                      const rect = trackEl?.getBoundingClientRect();
                      const rawTime = rect
                        ? ((e.clientX - rect.left) / Math.max(1, rect.width)) * totalDuration
                        : aclip.startTime;
                      const safeClickTime = Number(
                        Math.max(aclip.startTime, Math.min(clipEnd, rawTime)).toFixed(2)
                      );
                      timelineDragRef.current = {
                        active: true,
                        moved: false,
                        kind: 'audio',
                        track: 'audio',
                        mode: 'move',
                        clipId: aclip.id,
                        startClientX: e.clientX,
                        clickTime: safeClickTime,
                        origStartTime: aclip.startTime,
                        origTrimStart: aclip.trimStart,
                        origDuration: aclip.duration,
                        sourceDuration: srcTotal,
                        speed: aclip.speed,
                        trackWidthPx: rect?.width || 400,
                      };
                    }}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className={`group absolute top-1.5 bottom-1.5 rounded-md overflow-hidden border touch-none select-none cursor-pointer ${
                      active
                        ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400 font-bold'
                        : aclip.muted
                        ? 'bg-slate-800/80 text-slate-400 border-white/10 line-through'
                        : 'bg-emerald-950/85 text-emerald-200 border-emerald-500/40 hover:border-emerald-400'
                    }`}
                    title="Clique em qualquer ponto para cortar ou arraste para mover"
                  >
                    {/* Live trimmed waveform */}
                    <div className="absolute inset-x-3 inset-y-1 flex items-center gap-[1px] opacity-65 pointer-events-none">
                      {visiblePeaks.map((pk, idx) => (
                        <div
                          key={idx}
                          style={{ height: `${Math.max(14, Math.round(pk * 100))}%` }}
                          className={`flex-1 rounded-full ${
                            aclip.muted ? 'bg-slate-600' : active ? 'bg-emerald-300' : 'bg-emerald-400/75'
                          }`}
                        />
                      ))}
                    </div>

                    {/* Label overlay */}
                    <div className="relative z-10 h-full px-3.5 flex items-center gap-1.5 pointer-events-none">
                      <Music className="w-3 h-3 shrink-0" />
                      <span className="text-[11px] truncate drop-shadow">{aclip.name}</span>
                      <span className="ml-auto text-[10px] font-mono opacity-80 shrink-0">
                        {aclip.duration.toFixed(1)}s
                      </span>
                    </div>

                    {/* Left drag-to-trim handle */}
                    <div
                      title="Arraste para cortar início do áudio"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setIsPlaying(false);
                        setSelectedAudioClipId(aclip.id);
                        setSelectedClipId(null);
                        const trackEl = e.currentTarget.parentElement?.parentElement;
                        timelineDragRef.current = {
                          active: true,
                          moved: false,
                          kind: 'audio',
                          track: 'audio',
                          mode: 'trim-left',
                          clipId: aclip.id,
                          startClientX: e.clientX,
                          clickTime: aclip.startTime,
                          origStartTime: aclip.startTime,
                          origTrimStart: aclip.trimStart,
                          origDuration: aclip.duration,
                          sourceDuration: srcTotal,
                          speed: aclip.speed,
                          trackWidthPx: trackEl?.getBoundingClientRect().width || 400,
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      className="absolute left-0 top-0 bottom-0 w-3 bg-emerald-400/80 hover:bg-emerald-300 cursor-ew-resize touch-none flex items-center justify-center z-20"
                    >
                      <span className="w-0.5 h-5 rounded bg-slate-950/80" />
                    </div>

                    {/* Right drag-to-trim handle */}
                    <div
                      title="Arraste para cortar fim do áudio"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setIsPlaying(false);
                        setSelectedAudioClipId(aclip.id);
                        setSelectedClipId(null);
                        const trackEl = e.currentTarget.parentElement?.parentElement;
                        timelineDragRef.current = {
                          active: true,
                          moved: false,
                          kind: 'audio',
                          track: 'audio',
                          mode: 'trim-right',
                          clipId: aclip.id,
                          startClientX: e.clientX,
                          clickTime: clipEnd,
                          origStartTime: aclip.startTime,
                          origTrimStart: aclip.trimStart,
                          origDuration: aclip.duration,
                          sourceDuration: srcTotal,
                          speed: aclip.speed,
                          trackWidthPx: trackEl?.getBoundingClientRect().width || 400,
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      className="absolute right-0 top-0 bottom-0 w-3 bg-emerald-400/80 hover:bg-emerald-300 cursor-ew-resize touch-none flex items-center justify-center z-20"
                    >
                      <span className="w-0.5 h-5 rounded bg-slate-950/80" />
                    </div>
                  </div>
                );
              })
            )}
            {cutAnchor && cutAnchor.track === 'audio' && (
              <div
                style={{ left: `${(cutAnchor.time / totalDuration) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-rose-400 pointer-events-none z-20"
              />
            )}
            <div
              style={{ left: `${(currentTime / totalDuration) * 100}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none z-30"
            />
          </div>
        </div>
        </div>
      </AerialTimeline>
    </div>
  );
};
