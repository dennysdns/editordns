import { MediaFile, MediaKind, VirtualFolderId } from '../types/studio';
import { decodeAudioBlob } from './audioEngine';

export const SUPPORTED_AUDIO_EXTS = ['mp3', 'wav', 'aac', 'ogg', 'm4a'];
export const SUPPORTED_VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
export const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

export const ALL_ACCEPTED_EXTENSIONS = [
  ...SUPPORTED_AUDIO_EXTS,
  ...SUPPORTED_VIDEO_EXTS,
  ...SUPPORTED_IMAGE_EXTS,
]
  .map((ext) => `.${ext}`)
  .join(',');

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function detectMediaKind(ext: string, mime: string): MediaKind | null {
  if (SUPPORTED_AUDIO_EXTS.includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (SUPPORTED_VIDEO_EXTS.includes(ext) || mime.startsWith('video/')) return 'video';
  if (SUPPORTED_IMAGE_EXTS.includes(ext) || mime.startsWith('image/')) return 'image';
  return null;
}

export function inferFolderForKind(kind: MediaKind, currentFolder: VirtualFolderId): VirtualFolderId {
  if (currentFolder !== 'internal') return currentFolder;
  if (kind === 'audio') return 'music';
  if (kind === 'video') return 'videos';
  if (kind === 'image') return 'images';
  return 'downloads';
}

export async function processImportedFile(
  file: File | Blob,
  filename: string,
  targetFolder: VirtualFolderId,
  customFolderId?: string
): Promise<MediaFile | null> {
  const ext = getExtension(filename);
  const mimeType = file.type || guessMimeFromExt(ext);
  const kind = detectMediaKind(ext, mimeType);
  if (!kind) return null;

  const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const folder = inferFolderForKind(kind, targetFolder);
  let duration: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let thumbnailDataUrl: string | undefined;
  let supported = true;
  let supportNote: string | undefined;

  if (kind === 'image') {
    try {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      width = img.naturalWidth;
      height = img.naturalHeight;
      thumbnailDataUrl = drawThumbFromImage(img);
      URL.revokeObjectURL(url);
    } catch {
      supported = false;
      supportNote = 'Não foi possível decodificar esta imagem neste dispositivo.';
    }
  } else if (kind === 'video') {
    try {
      const url = URL.createObjectURL(file);
      const meta = await probeVideoMetadata(url);
      duration = meta.duration;
      width = meta.width;
      height = meta.height;
      thumbnailDataUrl = meta.thumbnail;
      URL.revokeObjectURL(url);
    } catch {
      supported = false;
      supportNote = `Formato .${ext.toUpperCase()} importado, porém o codec não é decodificado nativamente pelo navegador atual.`;
    }
  } else if (kind === 'audio') {
    try {
      const decoded = await decodeAudioBlob(file);
      duration = decoded.duration;
    } catch {
      // Fallback probe via HTMLAudioElement
      try {
        const url = URL.createObjectURL(file);
        duration = await probeAudioDuration(url);
        URL.revokeObjectURL(url);
      } catch {
        supported = false;
        supportNote = `Codec de áudio .${ext.toUpperCase()} limitado neste dispositivo.`;
      }
    }
  }

  return {
    id,
    name: filename,
    extension: ext || kind,
    kind,
    mimeType,
    size: file.size,
    folder,
    customFolderId: folder === 'custom' ? customFolderId : undefined,
    duration,
    width,
    height,
    blob: file,
    thumbnailDataUrl,
    supported,
    supportNote,
    createdAt: Date.now(),
  };
}

function guessMimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    webm: 'video/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] || 'application/octet-stream';
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

function drawThumbFromImage(img: HTMLImageElement): string {
  const c = document.createElement('canvas');
  const maxW = 240;
  const scale = Math.min(1, maxW / Math.max(1, img.naturalWidth));
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  return c.toDataURL('image/jpeg', 0.72);
}

function probeVideoMetadata(
  url: string
): Promise<{ duration: number; width: number; height: number; thumbnail: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const timer = window.setTimeout(() => {
      reject(new Error('Video probe timeout'));
    }, 5000);

    video.onloadeddata = () => {
      video.currentTime = Math.min(0.25, (video.duration || 1) * 0.1);
    };

    video.onseeked = () => {
      window.clearTimeout(timer);
      const c = document.createElement('canvas');
      const w = video.videoWidth || 320;
      const h = video.videoHeight || 180;
      const scale = Math.min(1, 240 / w);
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, c.width, c.height);
      resolve({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: w,
        height: h,
        thumbnail: c.toDataURL('image/jpeg', 0.72),
      });
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Unsupported video codec'));
    };

    video.src = url;
  });
}

function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => reject(new Error('Unsupported audio'));
    audio.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
