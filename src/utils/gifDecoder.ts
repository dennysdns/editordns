export interface DecodedGifFrame {
  canvas: HTMLCanvasElement;
  delayMs: number;
}

export interface DecodedGif {
  frames: DecodedGifFrame[];
  totalDurationMs: number;
  width: number;
  height: number;
}

interface ImageDecoderFrameResult {
  image: {
    displayWidth: number;
    displayHeight: number;
    duration?: number;
    close: () => void;
  };
  complete: boolean;
}

interface NativeImageDecoder {
  tracks: {
    ready: Promise<void>;
    selectedTrack?: { frameCount: number };
  };
  decode: (opts: { frameIndex: number }) => Promise<ImageDecoderFrameResult>;
  close: () => void;
}

export async function decodeAnimatedGifBlob(blob: Blob, mimeType: string): Promise<DecodedGif | null> {
  const WinDecoder = (window as unknown as {
    ImageDecoder?: new (init: { data: BufferSource | ReadableStream<Uint8Array>; type: string }) => NativeImageDecoder;
  }).ImageDecoder;

  if (!WinDecoder) return null;

  try {
    const buffer = await blob.arrayBuffer();
    const decoder = new WinDecoder({ data: buffer, type: mimeType || 'image/gif' });
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (frameCount <= 1) {
      decoder.close();
      return null;
    }

    const frames: DecodedGifFrame[] = [];
    let totalDurationMs = 0;
    let width = 0;
    let height = 0;

    for (let i = 0; i < frameCount; i++) {
      const result = await decoder.decode({ frameIndex: i });
      const vf = result.image;
      width = vf.displayWidth || width;
      height = vf.displayHeight || height;
      // VideoFrame.duration is in microseconds
      const delayMs = Math.max(20, Math.round((vf.duration ?? 100_000) / 1000));

      const c = document.createElement('canvas');
      c.width = Math.max(1, vf.displayWidth);
      c.height = Math.max(1, vf.displayHeight);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(vf as unknown as CanvasImageSource, 0, 0);
      }
      vf.close();

      frames.push({ canvas: c, delayMs });
      totalDurationMs += delayMs;
    }

    decoder.close();
    if (frames.length <= 1) return null;

    return {
      frames,
      totalDurationMs: Math.max(1, totalDurationMs),
      width,
      height,
    };
  } catch {
    return null;
  }
}

export function pickGifFrameAtTime(gif: DecodedGif, timeMs: number): HTMLCanvasElement {
  if (gif.frames.length === 1) return gif.frames[0].canvas;
  const wrapped = ((timeMs % gif.totalDurationMs) + gif.totalDurationMs) % gif.totalDurationMs;
  let acc = 0;
  for (const frame of gif.frames) {
    acc += frame.delayMs;
    if (wrapped < acc) return frame.canvas;
  }
  return gif.frames[gif.frames.length - 1].canvas;
}
