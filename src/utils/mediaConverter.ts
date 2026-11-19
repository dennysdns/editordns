import { decodeAudioBlob, encodeAudioBufferToWav } from './audioEngine';
import { getSupportedMimeCandidates } from './videoExporter';

export type AudioTargetFormat = 'wav' | 'webm' | 'ogg' | 'm4a';
export type ImageTargetFormat = 'png' | 'jpg' | 'webp' | 'bmp';
export type VideoTargetFormat = 'mp4' | 'webm' | 'avi';

export interface ConvertResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  filename: string;
  width?: number;
  height?: number;
  duration?: number;
  note?: string;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'arquivo';
}

export function getBestAudioEncoderMime(target: Exclude<AudioTargetFormat, 'wav'>): {
  mimeType: string;
  extension: string;
  fallbackUsed: boolean;
} {
  const map: Record<Exclude<AudioTargetFormat, 'wav'>, { mimes: string[]; ext: string }> = {
    webm: {
      mimes: ['audio/webm;codecs=opus', 'audio/webm'],
      ext: 'webm',
    },
    ogg: {
      mimes: ['audio/ogg;codecs=opus', 'audio/ogg'],
      ext: 'ogg',
    },
    m4a: {
      mimes: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'],
      ext: 'm4a',
    },
  };

  if (typeof MediaRecorder !== 'undefined') {
    for (const mime of map[target].mimes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mimeType: mime, extension: map[target].ext, fallbackUsed: false };
      }
    }
    const fallbacks: { mime: string; ext: string }[] = [
      { mime: 'audio/webm;codecs=opus', ext: 'webm' },
      { mime: 'audio/webm', ext: 'webm' },
      { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
      { mime: 'audio/mp4', ext: 'm4a' },
    ];
    for (const fb of fallbacks) {
      if (MediaRecorder.isTypeSupported(fb.mime)) {
        return { mimeType: fb.mime, extension: fb.ext, fallbackUsed: true };
      }
    }
  }

  return { mimeType: 'audio/webm', extension: 'webm', fallbackUsed: true };
}

export async function convertAudioOffline(
  sourceBlob: Blob,
  sourceName: string,
  options: {
    format: AudioTargetFormat;
    sampleRate: 44100 | 48000;
    channels: 1 | 2;
    onProgress?: (pct: number, status: string) => void;
  }
): Promise<ConvertResult> {
  options.onProgress?.(10, 'Decodificando fluxo de áudio...');
  const { buffer } = await decodeAudioBlob(sourceBlob);

  const lengthFrames = Math.max(1, Math.ceil(buffer.duration * options.sampleRate));
  const offline = new OfflineAudioContext(options.channels, lengthFrames, options.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);

  options.onProgress?.(45, 'Processando taxa de amostragem e canais...');
  const rendered = await offline.startRendering();

  if (options.format === 'wav') {
    options.onProgress?.(90, 'Gerando arquivo WAV PCM 16-bit...');
    const wavBlob = encodeAudioBufferToWav(rendered);
    options.onProgress?.(100, 'Conversão para WAV concluída!');
    return {
      blob: wavBlob,
      mimeType: 'audio/wav',
      extension: 'wav',
      filename: `${stripExt(sourceName)}_convertido.wav`,
      duration: rendered.duration,
    };
  }

  const encoderInfo = getBestAudioEncoderMime(options.format);
  if (typeof MediaRecorder === 'undefined') {
    const wavBlob = encodeAudioBufferToWav(rendered);
    return {
      blob: wavBlob,
      mimeType: 'audio/wav',
      extension: 'wav',
      filename: `${stripExt(sourceName)}_convertido.wav`,
      duration: rendered.duration,
      note: 'MediaRecorder indisponível; exportado em WAV sem perdas.',
    };
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const liveCtx = new AudioCtx({ sampleRate: options.sampleRate });
  if (liveCtx.state === 'suspended') await liveCtx.resume();

  const dest = liveCtx.createMediaStreamDestination();
  const playNode = liveCtx.createBufferSource();
  playNode.buffer = rendered;
  playNode.connect(dest);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(dest.stream, {
    mimeType: encoderInfo.mimeType,
    audioBitsPerSecond: 192_000,
  });

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error('Falha ao codificar áudio no navegador.'));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: encoderInfo.mimeType }));
    };
  });

  const startMs = performance.now();
  const totalMs = Math.max(200, rendered.duration * 1000);
  const timer = window.setInterval(() => {
    const pct = Math.min(97, 50 + Math.round(((performance.now() - startMs) / totalMs) * 47));
    options.onProgress?.(pct, `Codificando ${encoderInfo.extension.toUpperCase()}...`);
  }, 150);

  recorder.start(200);
  playNode.start(0);

  await new Promise<void>((resolve) => {
    playNode.onended = () => resolve();
    window.setTimeout(resolve, totalMs + 250);
  });

  window.clearInterval(timer);
  if (recorder.state !== 'inactive') recorder.stop();
  const outBlob = await blobPromise;
  await liveCtx.close();

  options.onProgress?.(100, 'Conversão de áudio concluída!');
  return {
    blob: outBlob,
    mimeType: encoderInfo.mimeType,
    extension: encoderInfo.extension,
    filename: `${stripExt(sourceName)}_convertido.${encoderInfo.extension}`,
    duration: rendered.duration,
    note: encoderInfo.fallbackUsed
      ? `Codec nativo .${options.format.toUpperCase()} indisponível neste dispositivo; convertido para .${encoderInfo.extension.toUpperCase()}.`
      : undefined,
  };
}

function encodeCanvasToBmp(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto 2D indisponível.');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h).data;
  const rowBytes = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowBytes * h;
  const fileSize = 54 + pixelBytes;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);

  // BMP header
  view.setUint8(0, 0x42); // B
  view.setUint8(1, 0x4d); // M
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);

  // DIB header (BITMAPINFOHEADER)
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true); // 24-bit RGB
  view.setUint32(34, pixelBytes, true);

  let offset = 54;
  for (let y = h - 1; y >= 0; y--) {
    const rowStart = offset;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const alpha = imgData[idx + 3] / 255;
      view.setUint8(offset++, Math.round(imgData[idx + 2] * alpha)); // B
      view.setUint8(offset++, Math.round(imgData[idx + 1] * alpha)); // G
      view.setUint8(offset++, Math.round(imgData[idx] * alpha)); // R
    }
    while (offset - rowStart < rowBytes) {
      view.setUint8(offset++, 0);
    }
  }

  return new Blob([buf], { type: 'image/bmp' });
}

export async function convertImageOffline(
  sourceBlob: Blob,
  sourceName: string,
  sourceKind: 'image' | 'video',
  options: {
    format: ImageTargetFormat;
    quality: number; // 0.1..1
    maxDimension?: number; // 0 = original
    jpgBgColor?: string;
    videoSeekSec?: number;
  }
): Promise<ConvertResult> {
  const url = URL.createObjectURL(sourceBlob);
  try {
    let srcW = 1080;
    let srcH = 1080;
    let drawable: CanvasImageSource;

    if (sourceKind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Não foi possível abrir o vídeo para capturar quadro.'));
      });
      const seekT = Math.min(video.duration || 0, Math.max(0, options.videoSeekSec || 0));
      if (seekT > 0.02) {
        video.currentTime = seekT;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
      }
      srcW = video.videoWidth || 1080;
      srcH = video.videoHeight || 1920;
      drawable = video;
    } else {
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Não foi possível decodificar esta imagem.'));
      });
      srcW = img.naturalWidth || 1080;
      srcH = img.naturalHeight || 1080;
      drawable = img;
    }

    let outW = srcW;
    let outH = srcH;
    if (options.maxDimension && options.maxDimension > 0) {
      const ratio = options.maxDimension / Math.max(srcW, srcH);
      if (ratio < 1 || Math.max(srcW, srcH) !== options.maxDimension) {
        outW = Math.max(1, Math.round(srcW * ratio));
        outH = Math.max(1, Math.round(srcH * ratio));
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível.');

    if (options.format === 'jpg' || options.format === 'bmp') {
      ctx.fillStyle = options.jpgBgColor || '#000000';
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(drawable, 0, 0, outW, outH);

    if (options.format === 'bmp') {
      const bmpBlob = encodeCanvasToBmp(canvas);
      return {
        blob: bmpBlob,
        mimeType: 'image/bmp',
        extension: 'bmp',
        filename: `${stripExt(sourceName)}_convertido.bmp`,
        width: outW,
        height: outH,
      };
    }

    const mimeMap: Record<Exclude<ImageTargetFormat, 'bmp'>, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
    };
    const mime = mimeMap[options.format];
    const outBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error(`Falha ao gerar imagem ${options.format.toUpperCase()}.`));
        },
        mime,
        options.format === 'png' ? undefined : Math.max(0.1, Math.min(1, options.quality))
      );
    });

    return {
      blob: outBlob,
      mimeType: mime,
      extension: options.format,
      filename: `${stripExt(sourceName)}_convertido.${options.format}`,
      width: outW,
      height: outH,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function convertVideoOffline(
  sourceBlob: Blob,
  sourceName: string,
  sourceKind: 'video' | 'image',
  options: {
    format: VideoTargetFormat;
    maxHeight: number; // 0 = original
    fps: 24 | 30;
    bitrateMbps: number;
    includeAudio: boolean;
    imageDurationSec?: number;
    onProgress?: (pct: number, status: string) => void;
  }
): Promise<ConvertResult> {
  const url = URL.createObjectURL(sourceBlob);
  try {
    let srcW = 1080;
    let srcH = 1920;
    let durationSec = options.imageDurationSec || 4;
    let videoEl: HTMLVideoElement | null = null;
    let imgEl: HTMLImageElement | null = null;

    if (sourceKind === 'video') {
      videoEl = document.createElement('video');
      videoEl.src = url;
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      await new Promise<void>((resolve, reject) => {
        videoEl!.onloadeddata = () => resolve();
        videoEl!.onerror = () => reject(new Error('Codec de vídeo não suportado neste dispositivo.'));
      });
      srcW = videoEl.videoWidth || 1080;
      srcH = videoEl.videoHeight || 1920;
      durationSec = Math.max(0.4, videoEl.duration || 4);
    } else {
      imgEl = new Image();
      imgEl.src = url;
      await new Promise<void>((resolve, reject) => {
        imgEl!.onload = () => resolve();
        imgEl!.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
      });
      srcW = imgEl.naturalWidth || 1080;
      srcH = imgEl.naturalHeight || 1080;
    }

    let outW = srcW;
    let outH = srcH;
    if (options.maxHeight > 0 && srcH > options.maxHeight) {
      const ratio = options.maxHeight / srcH;
      outH = options.maxHeight;
      outW = Math.max(2, Math.round((srcW * ratio) / 2) * 2);
    } else {
      outW = Math.max(2, Math.round(srcW / 2) * 2);
      outH = Math.max(2, Math.round(srcH / 2) * 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível.');

    if (options.format === 'avi') {
      return await encodeFramesAndAudioToAvi({
        sourceBlob,
        sourceName,
        sourceKind,
        videoEl,
        imgEl,
        canvas,
        ctx,
        width: outW,
        height: outH,
        durationSec,
        fps: options.fps,
        quality: Math.min(0.92, Math.max(0.6, options.bitrateMbps / 12)),
        includeAudio: options.includeAudio,
        onProgress: options.onProgress,
      });
    }

    const stream = canvas.captureStream(options.fps);
    let audioCtx: AudioContext | null = null;
    let audioSrcNode: AudioBufferSourceNode | null = null;
    let hasAudioTrack = false;

    if (sourceKind === 'video' && options.includeAudio) {
      try {
        options.onProgress?.(10, 'Extraindo e sincronizando áudio do vídeo...');
        const { buffer } = await decodeAudioBlob(sourceBlob);
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const dest = audioCtx.createMediaStreamDestination();
        audioSrcNode = audioCtx.createBufferSource();
        audioSrcNode.buffer = buffer;
        audioSrcNode.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => {
          stream.addTrack(t);
          hasAudioTrack = true;
        });
      } catch {
        hasAudioTrack = false;
      }
    }

    const mimeCandidates = getSupportedMimeCandidates(options.format, hasAudioTrack);
    const chosenMime = mimeCandidates[0] || 'video/webm';
    const actualExt = chosenMime.startsWith('video/mp4') ? 'mp4' : 'webm';

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: chosenMime,
      videoBitsPerSecond: Math.round(options.bitrateMbps * 1_000_000),
      ...(hasAudioTrack ? { audioBitsPerSecond: 128_000 } : {}),
    });

    const recordedPromise = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => reject(new Error('Erro durante a codificação do vídeo.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: chosenMime }));
    });

    recorder.start(200);
    if (videoEl) {
      videoEl.muted = true; // audio routed via AudioBufferSourceNode to avoid echo
      videoEl.currentTime = 0;
      await videoEl.play().catch(() => {});
    }
    if (audioSrcNode) {
      audioSrcNode.start(0);
    }

    const startTime = performance.now();
    const totalMs = durationSec * 1000;

    await new Promise<void>((resolve) => {
      const drawLoop = () => {
        const elapsedMs = performance.now() - startTime;
        const pct = Math.min(98, Math.round((elapsedMs / totalMs) * 100));
        options.onProgress?.(pct, `Convertendo vídeo (${actualExt.toUpperCase()}) · ${pct}%`);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, outW, outH);
        if (videoEl && videoEl.readyState >= 2) {
          ctx.drawImage(videoEl, 0, 0, outW, outH);
        } else if (imgEl) {
          ctx.drawImage(imgEl, 0, 0, outW, outH);
        }

        if (elapsedMs >= totalMs || (videoEl && videoEl.ended)) {
          resolve();
          return;
        }
        requestAnimationFrame(drawLoop);
      };
      requestAnimationFrame(drawLoop);
    });

    if (videoEl && !videoEl.paused) videoEl.pause();
    if (audioSrcNode) {
      try {
        audioSrcNode.stop();
      } catch {
        // ignore
      }
    }
    if (recorder.state !== 'inactive') recorder.stop();
    const outBlob = await recordedPromise;
    if (audioCtx) await audioCtx.close();

    options.onProgress?.(100, 'Conversão de vídeo concluída!');
    return {
      blob: outBlob,
      mimeType: chosenMime,
      extension: actualExt,
      filename: `${stripExt(sourceName)}_convertido.${actualExt}`,
      width: outW,
      height: outH,
      duration: durationSec,
      note:
        actualExt !== options.format
          ? `Codec .${options.format.toUpperCase()} nativo indisponível neste navegador; convertido em .${actualExt.toUpperCase()}.`
          : undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function writeFourCC(view: DataView, offset: number, fcc: string) {
  for (let i = 0; i < 4; i++) {
    view.setUint8(offset + i, fcc.charCodeAt(i));
  }
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function makeRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.byteLength % 2 === 1 ? 1 : 0;
  const buf = new Uint8Array(8 + payload.byteLength + pad);
  const view = new DataView(buf.buffer);
  writeFourCC(view, 0, fourcc);
  view.setUint32(4, payload.byteLength, true);
  buf.set(payload, 8);
  return buf;
}

function makeRiffList(listType: string, children: Uint8Array[]): Uint8Array {
  const inner = concatUint8(children);
  const buf = new Uint8Array(12 + inner.byteLength);
  const view = new DataView(buf.buffer);
  writeFourCC(view, 0, 'LIST');
  view.setUint32(4, 4 + inner.byteLength, true);
  writeFourCC(view, 8, listType);
  buf.set(inner, 12);
  return buf;
}

async function encodeFramesAndAudioToAvi(params: {
  sourceBlob: Blob;
  sourceName: string;
  sourceKind: 'video' | 'image';
  videoEl: HTMLVideoElement | null;
  imgEl: HTMLImageElement | null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  durationSec: number;
  fps: 24 | 30;
  quality: number;
  includeAudio: boolean;
  onProgress?: (pct: number, status: string) => void;
}): Promise<ConvertResult> {
  const {
    sourceBlob,
    sourceName,
    sourceKind,
    videoEl,
    imgEl,
    canvas,
    ctx,
    width,
    height,
    durationSec,
    fps,
    quality,
    includeAudio,
    onProgress,
  } = params;

  const frameCount = Math.max(1, Math.round(durationSec * fps));
  const jpegFrames: Uint8Array[] = [];

  if (sourceKind === 'image' && imgEl) {
    onProgress?.(30, 'Codificando quadro MJPEG para AVI...');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(imgEl, 0, 0, width, height);
    const singleBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao codificar quadro JPEG para AVI.'))),
        'image/jpeg',
        quality
      );
    });
    const singleBytes = new Uint8Array(await singleBlob.arrayBuffer());
    for (let i = 0; i < frameCount; i++) {
      jpegFrames.push(singleBytes);
    }
  } else if (videoEl) {
    videoEl.muted = true;
    for (let i = 0; i < frameCount; i++) {
      const targetT = Math.min(Math.max(0, (videoEl.duration || durationSec) - 0.02), i / fps);
      if (Math.abs(videoEl.currentTime - targetT) > 0.005) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            videoEl.removeEventListener('seeked', finish);
            resolve();
          };
          videoEl.addEventListener('seeked', finish, { once: true });
          videoEl.currentTime = targetT;
          window.setTimeout(finish, 600);
        });
      }
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      if (videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, width, height);
      }
      const frameBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar quadro JPEG para AVI.'))),
          'image/jpeg',
          quality
        );
      });
      jpegFrames.push(new Uint8Array(await frameBlob.arrayBuffer()));
      const pct = Math.min(82, Math.round(((i + 1) / frameCount) * 80));
      if (i % 3 === 0 || i === frameCount - 1) {
        onProgress?.(pct, `Codificando AVI (MJPEG) · Quadro ${i + 1}/${frameCount}`);
      }
    }
  }

  // Extract and resample audio into 44.1kHz stereo 16-bit PCM if available
  const audioSampleRate = 44100;
  const audioChannels = 2;
  const blockAlign = audioChannels * 2;
  let pcmInterleaved: Uint8Array | null = null;
  let totalAudioSamples = 0;

  if (sourceKind === 'video' && includeAudio) {
    try {
      onProgress?.(86, 'Extraindo áudio PCM para AVI...');
      const { buffer } = await decodeAudioBlob(sourceBlob);
      totalAudioSamples = Math.max(1, Math.round(durationSec * audioSampleRate));
      const offline = new OfflineAudioContext(audioChannels, totalAudioSamples, audioSampleRate);
      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      const left = rendered.getChannelData(0);
      const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
      const pcmBuf = new ArrayBuffer(totalAudioSamples * blockAlign);
      const pcmView = new DataView(pcmBuf);
      for (let s = 0; s < totalAudioSamples; s++) {
        const l = Math.max(-1, Math.min(1, left[s] || 0));
        const r = Math.max(-1, Math.min(1, right[s] || 0));
        pcmView.setInt16(s * 4, l < 0 ? l * 0x8000 : l * 0x7fff, true);
        pcmView.setInt16(s * 4 + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      }
      pcmInterleaved = new Uint8Array(pcmBuf);
    } catch {
      pcmInterleaved = null;
      totalAudioSamples = 0;
    }
  }

  onProgress?.(93, 'Empacotando contêiner RIFF AVI...');
  const hasAudio = Boolean(pcmInterleaved && totalAudioSamples > 0);
  const maxFrameBytes = jpegFrames.reduce((m, f) => Math.max(m, f.byteLength), 1024);

  // Build avih (56 bytes)
  const avih = new Uint8Array(56);
  const avihView = new DataView(avih.buffer);
  avihView.setUint32(0, Math.round(1_000_000 / fps), true); // dwMicroSecPerFrame
  avihView.setUint32(4, maxFrameBytes * fps + (hasAudio ? audioSampleRate * blockAlign : 0), true);
  avihView.setUint32(12, 0x10, true); // AVIF_HASINDEX
  avihView.setUint32(16, frameCount, true);
  avihView.setUint32(24, hasAudio ? 2 : 1, true); // dwStreams
  avihView.setUint32(28, maxFrameBytes, true);
  avihView.setUint32(32, width, true);
  avihView.setUint32(36, height, true);

  // Video strh (56 bytes)
  const vStrh = new Uint8Array(56);
  const vStrhView = new DataView(vStrh.buffer);
  writeFourCC(vStrhView, 0, 'vids');
  writeFourCC(vStrhView, 4, 'MJPG');
  vStrhView.setUint32(20, 1, true); // dwScale
  vStrhView.setUint32(24, fps, true); // dwRate
  vStrhView.setUint32(32, frameCount, true); // dwLength
  vStrhView.setUint32(36, maxFrameBytes, true);
  vStrhView.setUint32(40, 10000, true);
  vStrhView.setInt16(52, width, true);
  vStrhView.setInt16(54, height, true);

  // Video strf BITMAPINFOHEADER (40 bytes)
  const vStrf = new Uint8Array(40);
  const vStrfView = new DataView(vStrf.buffer);
  vStrfView.setUint32(0, 40, true);
  vStrfView.setInt32(4, width, true);
  vStrfView.setInt32(8, height, true);
  vStrfView.setUint16(12, 1, true);
  vStrfView.setUint16(14, 24, true);
  writeFourCC(vStrfView, 16, 'MJPG');
  vStrfView.setUint32(20, width * height * 3, true);

  const strlList: Uint8Array[] = [
    makeRiffList('strl', [makeRiffChunk('strh', vStrh), makeRiffChunk('strf', vStrf)]),
  ];

  if (hasAudio) {
    const aStrh = new Uint8Array(56);
    const aStrhView = new DataView(aStrh.buffer);
    writeFourCC(aStrhView, 0, 'auds');
    aStrhView.setUint32(20, blockAlign, true); // dwScale
    aStrhView.setUint32(24, audioSampleRate * blockAlign, true); // dwRate
    aStrhView.setUint32(32, totalAudioSamples, true); // dwLength
    aStrhView.setUint32(36, Math.ceil((audioSampleRate * blockAlign) / fps), true);
    aStrhView.setUint32(40, 10000, true);
    aStrhView.setUint32(44, blockAlign, true); // dwSampleSize

    const aStrf = new Uint8Array(18);
    const aStrfView = new DataView(aStrf.buffer);
    aStrfView.setUint16(0, 1, true); // PCM
    aStrfView.setUint16(2, audioChannels, true);
    aStrfView.setUint32(4, audioSampleRate, true);
    aStrfView.setUint32(8, audioSampleRate * blockAlign, true);
    aStrfView.setUint16(12, blockAlign, true);
    aStrfView.setUint16(14, 16, true);
    aStrfView.setUint16(16, 0, true);

    strlList.push(
      makeRiffList('strl', [makeRiffChunk('strh', aStrh), makeRiffChunk('strf', aStrf)])
    );
  }

  const hdrl = makeRiffList('hdrl', [makeRiffChunk('avih', avih), ...strlList]);

  // Build interleaved movi chunks + idx1 index entries
  const moviChildren: Uint8Array[] = [];
  const idxEntries: Array<{ ckid: string; flags: number; offset: number; length: number }> = [];
  let moviOffset = 4; // offset relative to 'movi' fourcc inside LIST

  for (let i = 0; i < frameCount; i++) {
    const framePayload = jpegFrames[i];
    const vChunk = makeRiffChunk('00dc', framePayload);
    idxEntries.push({
      ckid: '00dc',
      flags: 0x10, // AVIIF_KEYFRAME
      offset: moviOffset,
      length: framePayload.byteLength,
    });
    moviChildren.push(vChunk);
    moviOffset += vChunk.byteLength;

    if (hasAudio && pcmInterleaved) {
      const sStart = Math.floor((i * totalAudioSamples) / frameCount);
      const sEnd = Math.floor(((i + 1) * totalAudioSamples) / frameCount);
      const byteStart = sStart * blockAlign;
      const byteEnd = sEnd * blockAlign;
      if (byteEnd > byteStart) {
        const aPayload = pcmInterleaved.subarray(byteStart, byteEnd);
        const aChunk = makeRiffChunk('01wb', aPayload);
        idxEntries.push({
          ckid: '01wb',
          flags: 0x10,
          offset: moviOffset,
          length: aPayload.byteLength,
        });
        moviChildren.push(aChunk);
        moviOffset += aChunk.byteLength;
      }
    }
  }

  const movi = makeRiffList('movi', moviChildren);

  const idxPayload = new Uint8Array(idxEntries.length * 16);
  const idxView = new DataView(idxPayload.buffer);
  idxEntries.forEach((entry, idx) => {
    const base = idx * 16;
    writeFourCC(idxView, base, entry.ckid);
    idxView.setUint32(base + 4, entry.flags, true);
    idxView.setUint32(base + 8, entry.offset, true);
    idxView.setUint32(base + 12, entry.length, true);
  });
  const idx1 = makeRiffChunk('idx1', idxPayload);

  const riffBody = concatUint8([hdrl, movi, idx1]);
  const aviHeader = new Uint8Array(12);
  const aviHeaderView = new DataView(aviHeader.buffer);
  writeFourCC(aviHeaderView, 0, 'RIFF');
  aviHeaderView.setUint32(4, 4 + riffBody.byteLength, true);
  writeFourCC(aviHeaderView, 8, 'AVI ');

  const aviBlob = new Blob(
    [aviHeader.buffer as ArrayBuffer, riffBody.buffer as ArrayBuffer],
    { type: 'video/x-msvideo' }
  );
  onProgress?.(100, 'Conversão para AVI concluída!');

  return {
    blob: aviBlob,
    mimeType: 'video/x-msvideo',
    extension: 'avi',
    filename: `${stripExt(sourceName)}_convertido.avi`,
    width,
    height,
    duration: durationSec,
  };
}
