import { MediaFile } from '../types/studio';
import { processImportedFile } from './mediaImporter';
import { getBestSupportedVideoMime } from './videoExporter';

function encodeUncompressedGif89a(
  frames: Uint8Array[], // indexed color bytes (0..15) per frame, width*height each
  paletteRgb: Uint8Array, // 16 * 3 = 48 bytes
  width: number,
  height: number,
  delayCs = 12
): Blob {
  const bytes: number[] = [];
  const pushStr = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const pushU16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };

  // Header + Logical Screen Descriptor (4-bit palette = 16 colors)
  pushStr('GIF89a');
  pushU16(width);
  pushU16(height);
  bytes.push(0x83, 0x00, 0x00); // Global Color Table flag=1, color res=0, size=3 (2^(3+1)=16 colors)
  for (let i = 0; i < 48; i++) bytes.push(paletteRgb[i] ?? 0);

  // Netscape 2.0 looping Application Extension
  bytes.push(0x21, 0xff, 11);
  pushStr('NETSCAPE2.0');
  bytes.push(3, 1);
  pushU16(0); // infinite loop
  bytes.push(0);

  // Uncompressed LZW bit-packer with minCodeSize = 4 (clear=16, eoi=17, 5-bit codes)
  const encodePixelsLzw = (pixels: Uint8Array): number[] => {
    const out: number[] = [];
    let bitBuf = 0;
    let bitCount = 0;
    const writeCode5 = (code: number) => {
      bitBuf |= (code & 0x1f) << bitCount;
      bitCount += 5;
      while (bitCount >= 8) {
        out.push(bitBuf & 0xff);
        bitBuf >>= 8;
        bitCount -= 8;
      }
    };
    writeCode5(16); // Clear code
    for (let i = 0; i < pixels.length; i++) {
      writeCode5(pixels[i] & 0x0f);
      if ((i + 1) % 12 === 0) writeCode5(16); // keep code width at 5 bits
    }
    writeCode5(17); // EOI
    if (bitCount > 0) out.push(bitBuf & 0xff);
    return out;
  };

  for (const framePixels of frames) {
    // Graphic Control Extension (transparent color index 0)
    bytes.push(0x21, 0xf9, 4, 0x09); // dispose=2 (restore bg), transparent=1
    pushU16(delayCs);
    bytes.push(0, 0);

    // Image Descriptor
    bytes.push(0x2c);
    pushU16(0);
    pushU16(0);
    pushU16(width);
    pushU16(height);
    bytes.push(0x00);

    // Image Data
    bytes.push(4); // LZW minimum code size
    const compressed = encodePixelsLzw(framePixels);
    for (let i = 0; i < compressed.length; i += 255) {
      const chunk = compressed.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0x00); // block terminator
  }

  bytes.push(0x3b); // Trailer
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

export async function createLocalFolderSamples(): Promise<MediaFile[]> {
  const results: MediaFile[] = [];

  // 1. Real PNG sticker
  const pngCanvas = document.createElement('canvas');
  pngCanvas.width = 256;
  pngCanvas.height = 256;
  const pctx = pngCanvas.getContext('2d');
  if (pctx) {
    pctx.clearRect(0, 0, 256, 256);
    pctx.fillStyle = '#F59E0B';
    pctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2;
      const rad = i % 2 === 0 ? 105 : 46;
      const px = 128 + Math.cos(ang) * rad;
      const py = 128 + Math.sin(ang) * rad;
      if (i === 0) pctx.moveTo(px, py);
      else pctx.lineTo(px, py);
    }
    pctx.closePath();
    pctx.fill();
    pctx.lineWidth = 8;
    pctx.strokeStyle = '#FEF3C7';
    pctx.stroke();

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      pngCanvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (pngBlob) {
      const mf = await processImportedFile(pngBlob, 'estrela_sticker.png', 'images');
      if (mf) results.push(mf);
    }
  }

  // 2. Real animated GIF89a (64x64 pulsing neon orb loop, 6 frames)
  const gw = 64;
  const gh = 64;
  const palette = new Uint8Array(48);
  const colors = [
    [0, 0, 0], // 0 transparent
    [6, 182, 212], // 1 cyan
    [245, 158, 11], // 2 amber
    [255, 255, 255], // 3 white
    [59, 130, 246], // 4 blue
  ];
  colors.forEach((rgb, idx) => {
    palette[idx * 3] = rgb[0];
    palette[idx * 3 + 1] = rgb[1];
    palette[idx * 3 + 2] = rgb[2];
  });
  const gifFrames: Uint8Array[] = [];
  for (let f = 0; f < 6; f++) {
    const px = new Uint8Array(gw * gh);
    const radius = 12 + Math.sin((f / 6) * Math.PI * 2) * 8;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const dist = Math.hypot(x - gw / 2, y - gh / 2);
        if (dist <= radius * 0.45) px[y * gw + x] = 3;
        else if (dist <= radius * 0.8) px[y * gw + x] = f % 2 === 0 ? 1 : 2;
        else if (dist <= radius) px[y * gw + x] = 4;
      }
    }
    gifFrames.push(px);
  }
  const gifBlob = encodeUncompressedGif89a(gifFrames, palette, gw, gh, 12);
  const gifMedia = await processImportedFile(gifBlob, 'orb_animado.gif', 'images');
  if (gifMedia) results.push(gifMedia);

  // 3. Real local animated video sample (MP4/WebM via Canvas captureStream)
  try {
    const vCanvas = document.createElement('canvas');
    vCanvas.width = 360;
    vCanvas.height = 360;
    const vctx = vCanvas.getContext('2d');
    if (vctx && typeof MediaRecorder !== 'undefined') {
      const { mimeType, extension } = getBestSupportedVideoMime('mp4', false);
      const stream = vCanvas.captureStream(24);
      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1_500_000,
      });
      const chunks: BlobPart[] = [];
      const donePromise = new Promise<Blob>((resolve) => {
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      rec.start(100);
      const start = performance.now();
      const totalMs = 900;
      await new Promise<void>((resolve) => {
        const draw = () => {
          const p = Math.min(1, (performance.now() - start) / totalMs);
          vctx.fillStyle = '#0B0D11';
          vctx.fillRect(0, 0, 360, 360);
          vctx.strokeStyle = '#06B6D4';
          vctx.lineWidth = 8;
          vctx.beginPath();
          vctx.arc(180, 180, 50 + Math.sin(p * Math.PI * 2) * 35, 0, Math.PI * 2);
          vctx.stroke();
          vctx.fillStyle = '#F59E0B';
          vctx.beginPath();
          vctx.arc(
            180 + Math.cos(p * Math.PI * 2) * 95,
            180 + Math.sin(p * Math.PI * 2) * 95,
            24,
            0,
            Math.PI * 2
          );
          vctx.fill();
          if (p >= 1) {
            resolve();
            return;
          }
          requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
      });
      if (rec.state !== 'inactive') rec.stop();
      const vidBlob = await donePromise;
      const vidMedia = await processImportedFile(vidBlob, `efeito_loop.${extension}`, 'videos');
      if (vidMedia) results.push(vidMedia);
    }
  } catch {
    // ignore if headless MediaRecorder unavailable
  }

  return results;
}
