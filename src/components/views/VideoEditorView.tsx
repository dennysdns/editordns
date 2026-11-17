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
} from 'lucide-react';
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
import { decodeAudioBlob, getAudioContext } from '../../utils/audioEngine';
import {
  ALL_ACCEPTED_EXTENSIONS,
  formatDuration,
  processImportedFile,
} from '../../utils/mediaImporter';
import { DecodedGif, pickGifFrameAtTime } from '../../utils/gifDecoder';

interface VideoEditorViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  imageCache: Map<string, HTMLImageElement>;
  gifCache: Map<string, DecodedGif>;
  videoCache: Map<string, HTMLVideoElement>;
  onUpdateProject: (updated: StudioProject) => void;
  onSaveProject: () => Promise<void>;
  onImportMedia: (files: MediaFile[]) => Promise<void>;
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
  onOpenExport,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const canvasDragRef = useRef<{
    active: boolean;
    mode: 'move' | 'resize' | 'rotate';
    clipId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origScale: number;
    origDist: number;
    origRotation: number;
    startAngle: number;
  }>({
    active: false,
    mode: 'move',
    clipId: '',
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origScale: 1,
    origDist: 100,
    origRotation: 0,
    startAngle: 0,
  });

  const timelineDragRef = useRef<{
    active: boolean;
    kind: 'video' | 'audio';
    mode: 'move' | 'trim-left' | 'trim-right';
    clipId: string;
    startClientX: number;
    origStartTime: number;
    origTrimStart: number;
    origDuration: number;
    sourceDuration: number;
    speed: number;
    trackWidthPx: number;
  }>({
    active: false,
    kind: 'video',
    mode: 'move',
    clipId: '',
    startClientX: 0,
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
        gainNode.connect(ctx.destination);

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

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = buildCssFilterString(clip.effects || DEFAULT_EFFECTS);
      ctx.translate(project.width / 2 + clip.x, project.height / 2 + clip.y);
      ctx.rotate((clip.rotation * Math.PI) / 180);
      ctx.scale(clip.scale, clip.scale);

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
            vel.playbackRate = Math.max(0.25, Math.min(4, clip.speed));
            vel.volume = Math.max(0, Math.min(1, clip.volume));
            vel.muted = false;
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
        const halfW = (w * Math.abs(selectedClip.scale)) / 2 + 10;
        const halfH = (h * Math.abs(selectedClip.scale)) / 2 + 10;
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
      }
    }
  }, [project, currentTime, imageCache, gifCache, videoCache, isPlaying, renderTick, selectedClip]);

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
    if (isPlaying) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);

    const activeClips = project.videoClips
      .filter((c) => {
        const end = c.startTime + c.duration / Math.max(0.25, c.speed);
        return currentTime >= c.startTime && currentTime <= end;
      })
      .sort((a, b) => (a.track === b.track ? 0 : a.track === 'video' ? -1 : 1));

    // Check resize & rotation handles of currently selected clip
    if (selectedClip && activeClips.some((c) => c.id === selectedClip.id)) {
      const { w, h } = getClipBaseDims(selectedClip);
      const halfW = (w * Math.abs(selectedClip.scale)) / 2 + 10;
      const halfH = (h * Math.abs(selectedClip.scale)) / 2 + 10;
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
          origDist: Math.max(20, Math.hypot(pt.x - cx, pt.y - cy)),
          origRotation: selectedClip.rotation,
          startAngle: 0,
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
      const halfW = (w * Math.abs(clip.scale)) / 2 + 18;
      const halfH = (h * Math.abs(clip.scale)) / 2 + 18;
      const { rx, ry } = toClipLocalSpace(pt, clip);
      if (Math.abs(rx) <= halfW && Math.abs(ry) <= halfH) {
        hitClip = clip;
        break;
      }
    }

    if (hitClip) {
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
        origDist: 100,
        origRotation: hitClip.rotation,
        startAngle: 0,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      setSelectedClipId(null);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = canvasDragRef.current;
    if (!drag.active) return;
    const target = project.videoClips.find((c) => c.id === drag.clipId);
    if (!target) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);

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
    } else if (drag.mode === 'resize') {
      const cx = project.width / 2 + target.x;
      const cy = project.height / 2 + target.y;
      const dist = Math.hypot(pt.x - cx, pt.y - cy);
      const nextScale = Number(
        Math.max(0.1, Math.min(5, drag.origScale * (dist / Math.max(20, drag.origDist)))).toFixed(2)
      );
      onUpdateProject({
        ...project,
        videoClips: project.videoClips.map((c) =>
          c.id === drag.clipId ? { ...c, scale: nextScale } : c
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
      return;
    }
    if (selectedAudioClip) {
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.filter((a) => a.id !== selectedAudioClip.id),
      });
      setSelectedAudioClipId(null);
    }
  };

  const splitSelectedClipAtPlayhead = () => {
    if (selectedClip) {
      const clipEnd =
        selectedClip.startTime + selectedClip.duration / Math.max(0.25, selectedClip.speed);
      if (currentTime <= selectedClip.startTime + 0.1 || currentTime >= clipEnd - 0.1) return;

      const firstPlayDur = currentTime - selectedClip.startTime;
      const firstSourceDur = firstPlayDur * selectedClip.speed;
      const remainSourceDur = Math.max(0.2, selectedClip.duration - firstSourceDur);

      const firstHalf: VideoClip = {
        ...selectedClip,
        duration: Number(firstSourceDur.toFixed(2)),
      };
      const secondHalf: VideoClip = {
        ...selectedClip,
        id: `vclip-${Date.now()}`,
        name: `${selectedClip.name} (Parte 2)`,
        startTime: Number(currentTime.toFixed(2)),
        trimStart: Number((selectedClip.trimStart + firstSourceDur).toFixed(2)),
        duration: Number(remainSourceDur.toFixed(2)),
      };

      onUpdateProject({
        ...project,
        videoClips: project.videoClips.flatMap((c) =>
          c.id === selectedClip.id ? [firstHalf, secondHalf] : [c]
        ),
      });
      setSelectedClipId(secondHalf.id);
      return;
    }

    if (selectedAudioClip) {
      const clipEnd =
        selectedAudioClip.startTime +
        selectedAudioClip.duration / Math.max(0.25, selectedAudioClip.speed);
      if (
        currentTime <= selectedAudioClip.startTime + 0.1 ||
        currentTime >= clipEnd - 0.1
      ) {
        return;
      }

      const firstPlayDur = currentTime - selectedAudioClip.startTime;
      const firstSourceDur = firstPlayDur * selectedAudioClip.speed;
      const remainSourceDur = Math.max(0.2, selectedAudioClip.duration - firstSourceDur);

      const firstHalf: AudioClip = {
        ...selectedAudioClip,
        duration: Number(firstSourceDur.toFixed(2)),
      };
      const secondHalf: AudioClip = {
        ...selectedAudioClip,
        id: `aclip-${Date.now()}`,
        name: `${selectedAudioClip.name} (Parte 2)`,
        startTime: Number(currentTime.toFixed(2)),
        trimStart: Number((selectedAudioClip.trimStart + firstSourceDur).toFixed(2)),
        duration: Number(remainSourceDur.toFixed(2)),
      };

      onUpdateProject({
        ...project,
        audioClips: project.audioClips.flatMap((a) =>
          a.id === selectedAudioClip.id ? [firstHalf, secondHalf] : [a]
        ),
      });
      setSelectedAudioClipId(secondHalf.id);
    }
  };

  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = timelineDragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startClientX;
    const dt = (dx / Math.max(120, drag.trackWidthPx)) * totalDuration;

    if (drag.kind === 'video') {
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
    timelineDragRef.current.active = false;
  };

  const visualMedia = mediaFiles.filter((m) => m.kind === 'video' || m.kind === 'image');
  const audioMedia = mediaFiles.filter((m) => m.kind === 'audio');

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 pb-24 lg:pb-6 space-y-4">
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
      <div className="rounded-xl bg-[#13161D] border border-white/8 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-base font-bold text-white">Editor de Vídeo Multipista</h1>
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(totalDuration)} · {project.width}×{project.height}
            </p>
          </div>
          <span
            className="rounded-lg bg-[#1A1E28] border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300 font-mono"
            title="Proporção Única do Projeto"
          >
            9:16 · {project.width}×{project.height}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="min-h-[40px] px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            {isPlaying ? 'PAUSAR' : 'PLAY'}
          </button>
          <button
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            className="min-h-[40px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            STOP
          </button>
          <button
            onClick={splitSelectedClipAtPlayhead}
            disabled={!selectedClip && !selectedAudioClip}
            className="min-h-[40px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-cyan-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            Dividir no Cursor
          </button>
          <button
            type="button"
            onClick={() => duplicateSelectedClip(false)}
            disabled={!selectedClip && !selectedAudioClip}
            className="min-h-[40px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-amber-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicar
          </button>
          <button
            type="button"
            onClick={deleteSelectedFromTimeline}
            disabled={!selectedClip && !selectedAudioClip}
            className="min-h-[40px] px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 disabled:opacity-40 text-xs font-medium text-red-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Apagar
          </button>
          <button
            onClick={async () => {
              await onSaveProject();
              setSaveLabel('Salvo!');
              window.setTimeout(() => setSaveLabel(null), 2000);
            }}
            className="min-h-[40px] px-3.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saveLabel || 'Salvar'}
          </button>
          {onOpenExport && (
            <button
              type="button"
              onClick={async () => {
                await onSaveProject();
                onOpenExport();
              }}
              className="min-h-[40px] px-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar Vídeo c/ Áudio
            </button>
          )}
        </div>
      </div>

      {/* Main Split: Media Bin + Preview Monitor + Clip Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr_310px] gap-4 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-300">Mídia & Áudio</h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3 h-3" />
              Importar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setMediaBinTab('visual')}
              className={`min-h-[34px] rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                mediaBinTab === 'visual'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-[#1A1E28] text-slate-300'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              Vídeos/Img ({visualMedia.length})
            </button>
            <button
              type="button"
              onClick={() => setMediaBinTab('audio')}
              className={`min-h-[34px] rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                mediaBinTab === 'audio'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-[#1A1E28] text-slate-300'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              Áudio ({audioMedia.length})
            </button>
          </div>

          {mediaBinTab === 'visual' ? (
            <>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    importTargetTrackRef.current = 'overlay';
                    fileInputRef.current?.click();
                  }}
                  className="w-full min-h-[38px] rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-xs font-semibold text-cyan-200 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />+ Criar Sobreposição (Vídeo/GIF/Img)
                </button>
                <button
                  type="button"
                  onClick={addOverlayTextClip}
                  className="w-full min-h-[36px] rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Type className="w-3.5 h-3.5" />+ Texto / Legenda na Sobreposição
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1.5">
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
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[38px] rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Music className="w-3.5 h-3.5" />+ Importar Áudio (MP3/WAV/M4A)
              </button>
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {audioMedia.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Importe músicas ou efeitos sonoros MP3/WAV/AAC/OGG acima para adicionar ao vídeo.
                  </p>
                ) : (
                  audioMedia.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => void appendAudioClipFromMedia(m)}
                      className="w-full flex items-center gap-2.5 rounded-lg bg-[#1A1E28] hover:bg-emerald-500/15 border border-white/5 hover:border-emerald-500/30 p-2 text-left cursor-pointer"
                    >
                      <Music className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white truncate">{m.name}</p>
                        <p className="text-[10px] font-mono text-slate-400">
                          + Adicionar Áudio {formatDuration(m.duration)}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Center Video Monitor (Touch + Mouse Drag / Resize / Rotate) */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-2.5">
          <div className="w-full rounded-lg bg-[#0B0D11] border border-white/10 overflow-hidden p-2 flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={project.width}
              height={project.height}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className="max-h-[440px] w-auto max-w-full h-auto mx-auto block touch-none select-none cursor-grab active:cursor-grabbing"
            />
          </div>
          <div className="text-[11px] text-slate-400 px-1 flex flex-wrap items-center justify-between gap-2">
            <span>
              Arraste imagens e vídeos com o dedo ou mouse · Cantos âmbar para redimensionar · Pino ciano para girar
            </span>
            {selectedClip && (
              <span className="font-mono text-amber-300">
                X:{selectedClip.x} Y:{selectedClip.y} · {selectedClip.scale.toFixed(2)}×
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs font-mono text-slate-400 w-12">
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
            <span className="text-xs font-mono text-slate-400 w-12 text-right">
              {totalDuration.toFixed(1)}s
            </span>
          </div>
        </div>

        {/* Right Clip / Audio Inspector */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3.5 max-h-[640px] overflow-y-auto">
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
            <>
              <div className="flex items-center justify-between pb-2 border-b border-white/8">
                <h3 className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  {selectedClip.name}
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0B0D11] text-slate-300 shrink-0">
                  {selectedClip.track === 'video' ? 'Vídeo Principal' : 'Sobreposição'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => duplicateSelectedClip(true)}
                  className="min-h-[36px] px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-[11px] font-semibold text-amber-200 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  Duplicar no Vídeo Principal
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedFromTimeline}
                  className="min-h-[36px] px-2.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/35 text-[11px] font-semibold text-red-300 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  Apagar Clipe
                </button>
              </div>

              {selectedClip.track !== 'video' ? (
                <button
                  type="button"
                  onClick={insertSelectedIntoMainVideoTrack}
                  className="w-full min-h-[36px] px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[11px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
                  Inserir no Vídeo Principal (no Cursor)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={createOverlayFromSelected}
                  className="w-full min-h-[36px] px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[11px] font-semibold text-cyan-200 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
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
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Escala</span>
                  <span className="font-mono text-white">{selectedClip.scale.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={selectedClip.scale}
                  onChange={(e) => updateSelectedClip({ scale: Number(e.target.value) })}
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
          ) : (
            <p className="text-xs text-slate-400 py-10 text-center">
              Toque ou clique em um vídeo, imagem ou áudio na linha do tempo ou no palco para editar.
            </p>
          )}
        </div>
      </div>

      {/* Multi-Track Timeline (Video, Overlay & Audio) */}
      <div
        onPointerMove={handleTimelinePointerMove}
        onPointerUp={handleTimelinePointerUp}
        onPointerCancel={handleTimelinePointerUp}
        className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3 overflow-x-auto"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-300">
            Linha do Tempo Multipista (Vídeo, Sobreposição e Áudio)
          </span>
          <span className="text-[11px] text-slate-400">
            Toque em um vídeo para duplicar, inserir no Vídeo Principal ou apagar · Arraste para mover
          </span>
        </div>

        {(selectedClip || selectedAudioClip) && (
          <div className="rounded-lg bg-[#1A1E28] border border-amber-500/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white truncate">
              Selecionado:{' '}
              <span className="text-amber-300">
                {selectedClip ? selectedClip.name : selectedAudioClip?.name}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => duplicateSelectedClip(false)}
                className="min-h-[34px] px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Duplicar na Mesma Pista
              </button>
              {selectedClip && (
                <>
                  <button
                    type="button"
                    onClick={insertSelectedIntoMainVideoTrack}
                    className="min-h-[34px] px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-semibold text-cyan-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    {selectedClip.track === 'video'
                      ? 'Duplicar e Inserir no Vídeo Principal'
                      : 'Inserir no Vídeo Principal'}
                  </button>
                  <button
                    type="button"
                    onClick={createOverlayFromSelected}
                    className="min-h-[34px] px-3 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-xs font-semibold text-purple-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Criar Sobreposição
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={splitSelectedClipAtPlayhead}
                className="min-h-[34px] px-3 rounded-lg bg-[#0B0D11] hover:bg-white/10 border border-white/15 text-xs font-medium text-cyan-300 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Scissors className="w-3.5 h-3.5" />
                Dividir
              </button>
              <button
                type="button"
                onClick={deleteSelectedFromTimeline}
                className="min-h-[34px] px-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-xs font-semibold text-red-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Apagar
              </button>
            </div>
          </div>
        )}

        {(['overlay', 'video'] as const).map((trackName) => {
          const trackClips = project.videoClips.filter((c) => c.track === trackName);
          return (
            <div key={trackName} className="flex items-center gap-3 min-w-[640px]">
              <span
                className={`w-28 text-[11px] font-medium shrink-0 inline-flex items-center gap-1.5 ${
                  trackName === 'overlay' ? 'text-cyan-300' : 'text-slate-300'
                }`}
              >
                {trackName === 'overlay' && <Layers className="w-3.5 h-3.5" />}
                {trackName === 'overlay' ? 'Sobreposição' : 'Vídeo Principal'}
              </span>
              <div
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                  setIsPlaying(false);
                  setCurrentTime(Number((ratio * totalDuration).toFixed(2)));
                }}
                className={`flex-1 h-14 rounded-lg bg-[#0B0D11] border relative overflow-hidden ${
                  trackName === 'overlay' ? 'border-cyan-500/25' : 'border-white/8'
                }`}
              >
                {trackName === 'overlay' && trackClips.length === 0 && (
                  <div className="h-full flex items-center px-3 text-[11px] text-slate-500 pointer-events-none">
                    Use &ldquo;+ Criar Sobreposição&rdquo; à esquerda para sobrepor vídeos, GIFs, imagens ou textos
                  </div>
                )}
                {trackClips.map((clip) => {
                  const leftPct = (clip.startTime / totalDuration) * 100;
                  const widthPct = Math.max(
                    4,
                    (clip.duration / Math.max(0.25, clip.speed) / totalDuration) * 100
                  );
                  const active = clip.id === selectedClipId;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedClipId(clip.id);
                        setSelectedAudioClipId(null);
                        const trackEl = e.currentTarget.parentElement;
                        timelineDragRef.current = {
                          active: true,
                          kind: 'video',
                          mode: 'move',
                          clipId: clip.id,
                          startClientX: e.clientX,
                          origStartTime: clip.startTime,
                          origTrimStart: clip.trimStart,
                          origDuration: clip.duration,
                          sourceDuration: clip.duration,
                          speed: clip.speed,
                          trackWidthPx: trackEl?.getBoundingClientRect().width || 400,
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-1.5 bottom-1.5 rounded-md px-2 text-left truncate text-[11px] font-medium border touch-none select-none cursor-grab active:cursor-grabbing ${
                        active
                          ? trackName === 'overlay'
                            ? 'bg-cyan-400 text-slate-950 border-cyan-200 font-bold'
                            : 'bg-amber-500 text-slate-950 border-amber-300 font-bold'
                          : trackName === 'overlay'
                          ? 'bg-cyan-950/75 text-cyan-200 border-cyan-500/35 hover:border-cyan-400'
                          : 'bg-[#1E2534] text-slate-200 border-white/15 hover:border-amber-400/50'
                      }`}
                    >
                      {clip.name}
                    </button>
                  );
                })}
                {/* Playhead line */}
                <div
                  style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none"
                />
              </div>
            </div>
          );
        })}

        {/* Audio Track */}
            <div className="flex items-center gap-3 min-w-[640px]">
          <span className="w-28 text-[11px] font-medium text-emerald-300 shrink-0 inline-flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5" />
            Áudio / Música
          </span>
          <div
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
              setIsPlaying(false);
              setCurrentTime(Number((ratio * totalDuration).toFixed(2)));
            }}
            className="flex-1 h-16 rounded-lg bg-[#0B0D11] border border-emerald-500/20 relative overflow-hidden"
          >
            {project.audioClips.length === 0 ? (
              <div className="h-full flex items-center px-3 text-[11px] text-slate-500 pointer-events-none">
                Nenhum áudio adicionado — use a aba &ldquo;Áudio&rdquo; à esquerda para importar ou adicionar músicas
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
                      timelineDragRef.current = {
                        active: true,
                        kind: 'audio',
                        mode: 'move',
                        clipId: aclip.id,
                        startClientX: e.clientX,
                        origStartTime: aclip.startTime,
                        origTrimStart: aclip.trimStart,
                        origDuration: aclip.duration,
                        sourceDuration: srcTotal,
                        speed: aclip.speed,
                        trackWidthPx: trackEl?.getBoundingClientRect().width || 400,
                      };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className={`group absolute top-1.5 bottom-1.5 rounded-md overflow-hidden border touch-none select-none cursor-grab active:cursor-grabbing ${
                      active
                        ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400 font-bold'
                        : aclip.muted
                        ? 'bg-slate-800/80 text-slate-400 border-white/10 line-through'
                        : 'bg-emerald-950/85 text-emerald-200 border-emerald-500/40 hover:border-emerald-400'
                    }`}
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
                          kind: 'audio',
                          mode: 'trim-left',
                          clipId: aclip.id,
                          startClientX: e.clientX,
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
                          kind: 'audio',
                          mode: 'trim-right',
                          clipId: aclip.id,
                          startClientX: e.clientX,
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
            <div
              style={{ left: `${(currentTime / totalDuration) * 100}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none z-30"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
