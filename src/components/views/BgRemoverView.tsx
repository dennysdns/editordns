import React, { useEffect, useRef, useState } from 'react';
import {
  Wand2,
  Eraser,
  Paintbrush,
  Undo2,
  RotateCcw,
  Download,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import { GalleryItem, MediaFile } from '../../types/studio';
import { ALL_ACCEPTED_EXTENSIONS, processImportedFile } from '../../utils/mediaImporter';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface BgRemoverViewProps {
  mediaFiles: MediaFile[];
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

export const BgRemoverView: React.FC<BgRemoverViewProps> = ({
  mediaFiles,
  onImportMedia,
  onSaveToGallery,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);

  const imageMedia = mediaFiles.filter((m) => m.kind === 'image');
  const [selectedMediaId, setSelectedMediaId] = useState<string>(imageMedia[0]?.id || '');
  const [tool, setTool] = useState<'wand' | 'eraser' | 'restore'>('wand');
  const [tolerance, setTolerance] = useState(32);
  const [brushSize, setBrushSize] = useState(24);
  const [notice, setNotice] = useState<string | null>(null);

  const initSourceCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const orig = document.createElement('canvas');
    const mf = imageMedia.find((m) => m.id === selectedMediaId);

    if (!mf) {
      canvas.width = 700;
      canvas.height = 460;
      orig.width = 700;
      orig.height = 460;
      const octx = orig.getContext('2d')!;
      octx.fillStyle = '#E2E8F0';
      octx.fillRect(0, 0, 700, 460);
      octx.fillStyle = '#1E293B';
      octx.beginPath();
      octx.arc(350, 210, 110, 0, Math.PI * 2);
      octx.fill();
      octx.fillStyle = '#F59E0B';
      octx.beginPath();
      octx.arc(350, 210, 58, 0, Math.PI * 2);
      octx.fill();
      ctx.drawImage(orig, 0, 0);
      origCanvasRef.current = orig;
      historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
      return;
    }

    const url = URL.createObjectURL(mf.blob);
    const img = new Image();
    img.onload = () => {
      const w = Math.min(960, img.naturalWidth);
      const h = Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth));
      canvas.width = w;
      canvas.height = h;
      orig.width = w;
      orig.height = h;
      const octx = orig.getContext('2d')!;
      octx.drawImage(img, 0, 0, w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(orig, 0, 0);
      origCanvasRef.current = orig;
      historyRef.current = [ctx.getImageData(0, 0, w, h)];
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  useEffect(() => {
    initSourceCanvas();
  }, [selectedMediaId, mediaFiles.length]);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 15) historyRef.current.shift();
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || historyRef.current.length <= 1) return;
    historyRef.current.pop();
    const prev = historyRef.current[historyRef.current.length - 1];
    ctx.putImageData(prev, 0, 0);
  };

  const floodFillRemove = (startX: number, startY: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const sx = Math.max(0, Math.min(w - 1, Math.floor(startX)));
    const sy = Math.max(0, Math.min(h - 1, Math.floor(startY)));
    const sIdx = (sy * w + sx) * 4;
    const sr = data[sIdx];
    const sg = data[sIdx + 1];
    const sb = data[sIdx + 2];

    const visited = new Uint8Array(w * h);
    const stack: number[] = [sx, sy];
    const maxDist = (tolerance / 100) * 441.67 * 0.6;

    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      const p = y * w + x;
      if (visited[p]) continue;
      visited[p] = 1;

      const idx = p * 4;
      if (data[idx + 3] === 0) continue;
      const dist = Math.sqrt(
        (data[idx] - sr) ** 2 + (data[idx + 1] - sg) ** 2 + (data[idx + 2] - sb) ** 2
      );
      if (dist <= maxDist) {
        data[idx + 3] = 0;
        if (x > 0) stack.push(x - 1, y);
        if (x < w - 1) stack.push(x + 1, y);
        if (y > 0) stack.push(x, y - 1);
        if (y < h - 1) stack.push(x, y + 1);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    pushHistory();
  };

  const applyBrushAt = (cx: number, cy: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (tool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(cx, cy, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (tool === 'restore' && origCanvasRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, brushSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(origCanvasRef.current, 0, 0);
      ctx.restore();
    }
  };

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const handleSaveResult = (download: boolean) => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const filename = `sem_fundo_${Date.now()}.png`;
      if (download) triggerBlobDownload(blob, filename);

      const imported = await processImportedFile(blob, filename, 'images');
      if (imported) await onImportMedia([imported]);

      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'image',
        mimeType: 'image/png',
        size: blob.size,
        width: canvasRef.current?.width,
        height: canvasRef.current?.height,
        blob,
        thumbnailDataUrl: canvasRef.current?.toDataURL('image/png'),
        createdAt: Date.now(),
      });
      setNotice('Imagem sem fundo salva no projeto e em Minha Galeria!');
    }, 'image/png');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const m = await processImportedFile(f, f.name, 'images');
            if (m && m.kind === 'image') {
              await onImportMedia([m]);
              setSelectedMediaId(m.id);
            }
          }
          e.target.value = '';
        }}
      />

      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Removedor de Fundo Algorítmico (100% Offline)</h1>
          <p className="text-xs text-slate-400">
            Varinha Mágica por preenchimento de cor, Borracha Manual e Pincel Restaurador sem IA
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-3.5 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-white hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-amber-400" />
            Carregar Imagem
          </button>
          <button
            onClick={() => handleSaveResult(false)}
            className="min-h-[40px] px-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Salvar no Projeto e Galeria
          </button>
          <button
            onClick={() => handleSaveResult(true)}
            className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Exportar PNG Transparente
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={selectedMediaId}
              onChange={(e) => setSelectedMediaId(e.target.value)}
              className="rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white max-w-xs"
            >
              <option value="">Objeto Demo Offline</option>
              {imageMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <button
                onClick={handleUndo}
                className="min-h-[38px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Desfazer
              </button>
              <button
                onClick={initSourceCanvas}
                className="min-h-[38px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restaurar Tudo
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-checkerboard border border-white/10 overflow-hidden flex items-center justify-center p-2">
            <canvas
              ref={canvasRef}
              onPointerDown={(e) => {
                const pt = toCanvasPoint(e);
                if (tool === 'wand') {
                  floodFillRemove(pt.x, pt.y);
                } else {
                  drawingRef.current = true;
                  applyBrushAt(pt.x, pt.y);
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current) return;
                const pt = toCanvasPoint(e);
                applyBrushAt(pt.x, pt.y);
              }}
              onPointerUp={() => {
                if (drawingRef.current) {
                  drawingRef.current = false;
                  pushHistory();
                }
              }}
              className="max-h-[480px] w-auto object-contain touch-none cursor-crosshair"
            />
          </div>
        </div>

        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white pb-2 border-b border-white/8">
            Ferramentas de Recorte
          </h3>

          <div className="space-y-2">
            {[
              { id: 'wand', label: 'Varinha Mágica (Clique no Fundo)', icon: Wand2 },
              { id: 'eraser', label: 'Borracha Manual', icon: Eraser },
              { id: 'restore', label: 'Pincel Restaurar', icon: Paintbrush },
            ].map((item) => {
              const Icon = item.icon;
              const active = tool === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTool(item.id as typeof tool)}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 cursor-pointer ${
                    active
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'bg-[#1A1E28] text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {tool === 'wand' ? (
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Tolerância da Varinha</span>
                <span className="font-mono">{tolerance}%</span>
              </div>
              <input
                type="range"
                min={2}
                max={85}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <p className="text-[11px] text-slate-400 mt-2">
                Toque em qualquer área do fundo na imagem para remover regiões contínuas da mesma cor.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Tamanho do Pincel</span>
                <span className="font-mono">{brushSize} px</span>
              </div>
              <input
                type="range"
                min={4}
                max={80}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
