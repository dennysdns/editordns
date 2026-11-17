import { DEFAULT_CHROMA_KEY, DEFAULT_EFFECTS, MediaFile, StudioProject } from '../types/studio';
import {
  applyChromaKeyToImageData,
  buildCssFilterString,
  drawStudioBackground,
  drawTextLayer,
  ensureStudioBackgroundLoaded,
  renderAnimationFrameToCanvas,
} from './canvasRenderer';
import { DecodedGif, pickGifFrameAtTime } from './gifDecoder';
import { decodeAudioBlob, getAudioContext } from './audioEngine';

export interface ExportOptions {
  source: 'animation' | 'video';
  width: number;
  height: number;
  fps: number;
  videoBitsPerSecond: number;
  format: 'webm' | 'mp4';
  gifCache?: Map<string, DecodedGif>;
  onProgress?: (pct: number, statusText: string) => void;
}

export function getSupportedMimeCandidates(
  preferred: 'webm' | 'mp4',
  includeAudio: boolean
): string[] {
  const mp4Candidates = includeAudio
    ? [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4',
      ]
    : ['video/mp4;codecs=avc1', 'video/mp4'];

  const webmCandidates = includeAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  const ordered =
    preferred === 'mp4' ? [...mp4Candidates, ...webmCandidates] : [...webmCandidates, ...mp4Candidates];

  if (typeof MediaRecorder === 'undefined') return ['video/webm'];
  const supported = ordered.filter((c) => MediaRecorder.isTypeSupported(c));
  return supported.length > 0 ? supported : ['video/webm'];
}

export function getBestSupportedVideoMime(
  preferred: 'webm' | 'mp4',
  includeAudio = false
): {
  mimeType: string;
  extension: string;
} {
  const candidates = getSupportedMimeCandidates(preferred, includeAudio);
  const first = candidates[0] || 'video/webm';
  return {
    mimeType: first,
    extension: first.startsWith('video/mp4') ? 'mp4' : 'webm',
  };
}

interface PreparedAudioItem {
  buffer: AudioBuffer;
  startTime: number;
  trimStart: number;
  duration: number;
  speed: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  eqBass: number;
  eqMid: number;
  eqTreble: number;
}

export async function exportProjectVideoOffline(
  project: StudioProject,
  mediaFiles: MediaFile[],
  imageCache: Map<string, HTMLImageElement>,
  options: ExportOptions
): Promise<{ blob: Blob; mimeType: string; extension: string; durationSec: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto Canvas 2D indisponível para renderização.');

  await ensureStudioBackgroundLoaded();

  const stream = canvas.captureStream(options.fps);
  const mediaMap = new Map(mediaFiles.map((m) => [m.id, m]));
  const scheduledAudioNodes: AudioBufferSourceNode[] = [];
  let keepAliveNode: ConstantSourceNode | null = null;

  // Prepare and pre-decode all audio tracks (both AudioClips and VideoClip embedded audio)
  const preparedAudio: PreparedAudioItem[] = [];
  const hasSolo = project.audioClips.some((c) => c.solo);
  const activeAudio = project.audioClips.filter((c) => !c.muted && (!hasSolo || c.solo));

  for (const aclip of activeAudio) {
    const mf = mediaMap.get(aclip.mediaId);
    if (!mf) continue;
    try {
      const { buffer } = await decodeAudioBlob(mf.blob);
      preparedAudio.push({
        buffer,
        startTime: aclip.startTime,
        trimStart: aclip.trimStart,
        duration: aclip.duration,
        speed: aclip.speed,
        gain: aclip.gain,
        fadeIn: aclip.fadeIn,
        fadeOut: aclip.fadeOut,
        eqBass: aclip.eqBass,
        eqMid: aclip.eqMid,
        eqTreble: aclip.eqTreble,
      });
    } catch {
      // Skip undecodable audio clip
    }
  }

  if (options.source === 'video' && project.videoClips.length > 0) {
    const decodedVideoAudioCache = new Map<string, AudioBuffer | null>();
    for (const vclip of project.videoClips) {
      if (vclip.kind !== 'video' || !vclip.mediaId || vclip.volume <= 0) continue;
      let vBuf = decodedVideoAudioCache.get(vclip.mediaId);
      if (vBuf === undefined) {
        const mf = mediaMap.get(vclip.mediaId);
        if (mf) {
          try {
            const audioCtx = getAudioContext();
            const arr = await mf.blob.arrayBuffer();
            vBuf = await audioCtx.decodeAudioData(arr.slice(0));
          } catch {
            vBuf = null;
          }
        } else {
          vBuf = null;
        }
        decodedVideoAudioCache.set(vclip.mediaId, vBuf);
      }
      if (vBuf) {
        preparedAudio.push({
          buffer: vBuf,
          startTime: vclip.startTime,
          trimStart: vclip.trimStart,
          duration: vclip.duration,
          speed: vclip.speed,
          gain: vclip.volume,
          fadeIn: 0,
          fadeOut: 0,
          eqBass: 0,
          eqMid: 0,
          eqTreble: 0,
        });
      }
    }
  }

  let hasAudioTrack = false;
  let audioCtxRef: AudioContext | null = null;
  let audioDestRef: MediaStreamAudioDestinationNode | null = null;

  if (preparedAudio.length > 0) {
    try {
      const audioCtx = getAudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const dest = audioCtx.createMediaStreamDestination();

      // Silent keepalive keeps audio stream emitting continuously across gaps
      keepAliveNode = audioCtx.createConstantSource();
      keepAliveNode.offset.value = 0;
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      keepAliveNode.connect(silentGain);
      silentGain.connect(dest);
      keepAliveNode.start();

      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      hasAudioTrack = dest.stream.getAudioTracks().length > 0;
      audioCtxRef = audioCtx;
      audioDestRef = dest;
    } catch {
      hasAudioTrack = false;
    }
  }

  const cleanupAudio = () => {
    scheduledAudioNodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        // ignore already stopped
      }
    });
    if (keepAliveNode) {
      try {
        keepAliveNode.stop();
      } catch {
        // ignore already stopped
      }
      keepAliveNode = null;
    }
  };

  // Pick a MediaRecorder codec that accepts the attached tracks
  const mimeCandidates = getSupportedMimeCandidates(options.format, hasAudioTrack);
  let recorder: MediaRecorder | null = null;
  let activeMime = mimeCandidates[0] || 'video/webm';

  for (const candidate of mimeCandidates) {
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: candidate,
        videoBitsPerSecond: options.videoBitsPerSecond,
        ...(hasAudioTrack ? { audioBitsPerSecond: 128_000 } : {}),
      });
      activeMime = candidate;
      break;
    } catch {
      recorder = null;
    }
  }

  if (!recorder) {
    recorder = new MediaRecorder(stream);
    activeMime = recorder.mimeType || 'video/webm';
  }

  const extension = activeMime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder!.onstop = () => {
      cleanupAudio();
      resolve(new Blob(chunks, { type: activeMime }));
    };
  });

  const scaleX = options.width / project.width;
  const scaleY = options.height / project.height;

  // Schedule decoded audio synchronously right as recording starts so timing aligns with frame 0
  const schedulePreparedAudioNow = () => {
    if (!audioCtxRef || !audioDestRef || preparedAudio.length === 0) return;
    const baseTime = audioCtxRef.currentTime + 0.04;
    for (const item of preparedAudio) {
      try {
        const src = audioCtxRef.createBufferSource();
        src.buffer = item.buffer;
        src.playbackRate.value = Math.max(0.25, item.speed);

        const bass = audioCtxRef.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 120;
        bass.gain.value = item.eqBass;

        const mid = audioCtxRef.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.gain.value = item.eqMid;

        const treble = audioCtxRef.createBiquadFilter();
        treble.type = 'highshelf';
        treble.frequency.value = 6000;
        treble.gain.value = item.eqTreble;

        const gainNode = audioCtxRef.createGain();
        const startAt = baseTime + Math.max(0, item.startTime);
        const safeTrim = Math.max(0, Math.min(item.trimStart, Math.max(0, item.buffer.duration - 0.05)));
        const safeSourceDur = Math.max(
          0.05,
          Math.min(item.duration, item.buffer.duration - safeTrim)
        );
        const playDur = safeSourceDur / Math.max(0.25, item.speed);
        const fadeIn = Math.min(item.fadeIn, playDur * 0.45);
        const fadeOut = Math.min(item.fadeOut, playDur * 0.45);

        if (fadeIn > 0.01) {
          gainNode.gain.setValueAtTime(0.001, startAt);
          gainNode.gain.linearRampToValueAtTime(item.gain, startAt + fadeIn);
        } else {
          gainNode.gain.setValueAtTime(item.gain, startAt);
        }

        if (fadeOut > 0.01) {
          gainNode.gain.setValueAtTime(item.gain, startAt + Math.max(0, playDur - fadeOut));
          gainNode.gain.linearRampToValueAtTime(0.001, startAt + playDur);
        }

        src.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(gainNode);
        gainNode.connect(audioDestRef);

        src.start(startAt, safeTrim, safeSourceDur);
        scheduledAudioNodes.push(src);
      } catch {
        // ignore faulty single clip
      }
    }
  };

  if (options.source === 'animation' || project.videoClips.length === 0) {
    const totalFrames = Math.max(1, project.frames.length);
    const totalDurationSec = project.frames.reduce((acc, f) => acc + f.durationMs / 1000, 0);
    const animVideoMap = new Map<string, HTMLVideoElement>();

    for (const layer of project.layers) {
      if (layer.kind === 'video' && layer.mediaId && !animVideoMap.has(layer.mediaId)) {
        const mf = mediaMap.get(layer.mediaId);
        if (mf) {
          const v = document.createElement('video');
          v.muted = true;
          v.playsInline = true;
          v.src = URL.createObjectURL(mf.blob);
          await new Promise<void>((res) => {
            v.onloadeddata = () => res();
            v.onerror = () => res();
            window.setTimeout(res, 2000);
          });
          animVideoMap.set(layer.mediaId, v);
        }
      }
    }

    recorder.start(100);
    schedulePreparedAudioNow();
    const loopStart = performance.now();

    let elapsedAcc = 0;
    for (let i = 0; i < totalFrames; i++) {
      const frame = project.frames[i];
      animVideoMap.forEach((v) => {
        if (v.duration && Number.isFinite(v.duration)) {
          v.currentTime = (elapsedAcc / 1000) % v.duration;
        }
      });

      const off = document.createElement('canvas');
      off.width = project.width;
      off.height = project.height;
      const octx = off.getContext('2d');
      if (octx) {
        renderAnimationFrameToCanvas(octx, project, i, imageCache, {
          gifCache: options.gifCache,
          videoCache: animVideoMap,
          elapsedMs: elapsedAcc,
        });
        ctx.clearRect(0, 0, options.width, options.height);
        ctx.drawImage(off, 0, 0, options.width, options.height);
      }

      elapsedAcc += frame.durationMs;
      options.onProgress?.(
        Math.round(((i + 1) / totalFrames) * 100),
        `Renderizando quadro ${i + 1} de ${totalFrames}${hasAudioTrack ? ' (c/ áudio)' : ''}`
      );
      const remaining = Math.round(elapsedAcc - (performance.now() - loopStart));
      await waitMs(Math.max(16, remaining));
    }

    animVideoMap.forEach((v) => URL.revokeObjectURL(v.src));
    recorder.stop();
    const blob = await stopped;
    return { blob, mimeType: activeMime, extension, durationSec: totalDurationSec };
  }

  // Video Timeline render
  const videoElements = new Map<string, HTMLVideoElement>();
  const totalDur = Math.max(
    1,
    ...project.videoClips.map((c) => c.startTime + c.duration / Math.max(0.25, c.speed)),
    ...project.audioClips
      .filter((a) => !a.muted)
      .map((a) => a.startTime + a.duration / Math.max(0.25, a.speed))
  );

  for (const clip of project.videoClips) {
    if (clip.kind === 'video' && clip.mediaId && !videoElements.has(clip.mediaId)) {
      const mf = mediaMap.get(clip.mediaId);
      if (mf) {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.src = URL.createObjectURL(mf.blob);
        await new Promise<void>((res) => {
          v.onloadeddata = () => res();
          v.onerror = () => res();
          window.setTimeout(res, 2000);
        });
        videoElements.set(clip.mediaId, v);
      }
    }
  }

  recorder.start(100);
  schedulePreparedAudioNow();

  const totalSteps = Math.max(1, Math.ceil(totalDur * options.fps));
  const loopStart = performance.now();

  for (let s = 0; s < totalSteps; s++) {
    const t = s / options.fps;
    drawStudioBackground(ctx, options.width, options.height, '#0B0D11');

    const activeClips = project.videoClips
      .filter((c) => {
        const end = c.startTime + c.duration / Math.max(0.25, c.speed);
        return t >= c.startTime && t <= end;
      })
      .sort((a, b) => (a.track === b.track ? 0 : a.track === 'video' ? -1 : 1));

    for (const clip of activeClips) {
      const localT = (t - clip.startTime) * clip.speed + clip.trimStart;
      let fadeAlpha = clip.opacity;
      const elapsed = t - clip.startTime;
      const totalClipPlay = clip.duration / Math.max(0.25, clip.speed);
      if ((clip.transition === 'fade-in' || clip.transition === 'fade-both') && elapsed < 0.5) {
        fadeAlpha *= Math.max(0, elapsed / 0.5);
      }
      if ((clip.transition === 'fade-out' || clip.transition === 'fade-both') && totalClipPlay - elapsed < 0.5) {
        fadeAlpha *= Math.max(0, (totalClipPlay - elapsed) / 0.5);
      }

      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.filter = buildCssFilterString(clip.effects || DEFAULT_EFFECTS);
      ctx.translate(options.width / 2 + clip.x * scaleX, options.height / 2 + clip.y * scaleY);
      ctx.rotate((clip.rotation * Math.PI) / 180);
      ctx.scale(clip.scale, clip.scale);

      if (clip.kind === 'color') {
        ctx.fillStyle = clip.backgroundColor || '#1E293B';
        ctx.fillRect(-options.width / 2, -options.height / 2, options.width, options.height);
      } else if (clip.kind === 'image' && clip.mediaId) {
        const decodedGif = options.gifCache?.get(clip.mediaId);
        const gifFrame = decodedGif ? pickGifFrameAtTime(decodedGif, elapsed * 1000) : null;
        const img = imageCache.get(clip.mediaId);
        const sourceDrawable: CanvasImageSource | null =
          gifFrame || (img && img.naturalWidth > 0 ? img : null);

        if (sourceDrawable) {
          const srcW = decodedGif ? decodedGif.width : img!.naturalWidth;
          const srcH = decodedGif ? decodedGif.height : img!.naturalHeight;
          const fit = Math.min(options.width / Math.max(1, srcW), options.height / Math.max(1, srcH));
          const dw = srcW * fit;
          const dh = srcH * fit;
          if (clip.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(dw));
            off.height = Math.max(1, Math.round(dh));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(sourceDrawable, 0, 0, off.width, off.height);
              const imgData = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(imgData, clip.chromaKey || DEFAULT_CHROMA_KEY);
              octx.putImageData(imgData, 0, 0);
              ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
            }
          } else {
            ctx.drawImage(sourceDrawable, -dw / 2, -dh / 2, dw, dh);
          }
        }
      } else if (clip.kind === 'video' && clip.mediaId) {
        const v = videoElements.get(clip.mediaId);
        if (v && v.videoWidth > 0) {
          v.currentTime = Math.min(v.duration || localT, localT);
          const fit = Math.min(options.width / v.videoWidth, options.height / v.videoHeight);
          const dw = v.videoWidth * fit;
          const dh = v.videoHeight * fit;
          if (clip.chromaKey?.enabled) {
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.round(dw));
            off.height = Math.max(1, Math.round(dh));
            const octx = off.getContext('2d');
            if (octx) {
              octx.drawImage(v, 0, 0, off.width, off.height);
              const imgData = octx.getImageData(0, 0, off.width, off.height);
              applyChromaKeyToImageData(imgData, clip.chromaKey || DEFAULT_CHROMA_KEY);
              octx.putImageData(imgData, 0, 0);
              ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
            }
          } else {
            ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
          }
        }
      } else if (clip.kind === 'text' && clip.textConfig) {
        const progress = Math.min(1, elapsed / Math.max(0.1, totalClipPlay));
        drawTextLayer(ctx, clip.textConfig, progress);
      }

      ctx.restore();
    }

    options.onProgress?.(
      Math.round(((s + 1) / totalSteps) * 100),
      `Renderizando quadro ${s + 1} de ${totalSteps}${hasAudioTrack ? ' (c/ áudio)' : ''}`
    );
    const targetMs = ((s + 1) * 1000) / options.fps;
    const wait = Math.round(targetMs - (performance.now() - loopStart));
    await waitMs(Math.max(4, wait));
  }

  videoElements.forEach((v) => URL.revokeObjectURL(v.src));
  recorder.stop();
  const blob = await stopped;
  return { blob, mimeType: activeMime, extension, durationSec: totalDur };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
