import React, { useEffect, useRef, useState } from 'react';
import { Pipette, Download, Upload, CheckCircle2 } from 'lucide-react';
import { ChromaKeyConfig, GalleryItem, MediaFile } from '../../types/studio';
import { applyChromaKeyToImageData } from '../../utils/canvasRenderer';
import { ALL_ACCEPTED_EXTENSIONS, processImportedFile } from '../../utils/mediaImporter';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface ChromaKeyViewProps {
  mediaFiles: MediaFile[];
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

export const ChromaKeyView: React.FC<ChromaKeyViewProps> = ({
  mediaFiles,
  onImportMedia,
  onSaveToGallery,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceImgRef = useRef<HTMLImageElement | null>(null);

  const imageMedia = mediaFiles.filter((m) => m.kind === 'image');
  const [selectedMediaId, setSelectedMediaId] = useState<string>(imageMedia[0]?.id || '');
  const [config, setConfig] = useState<ChromaKeyConfig>({
    enabled: true,
    keyColor: '#00D13B',
    similarity: 36,
    smoothness: 14,
    spill: 35,
  });
  const [backdropMode, setBackdropMode] = useState<'transparent' | 'solid'>('transparent');
  const [backdropColor, setBackdropColor] = useState('#111827');
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Load selected image or generate an offline green-screen test sample on canvas
  const drawSampleOrImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const src = sourceImgRef.current;
    if (src && src.complete && src.naturalWidth > 0) {
      canvas.width = Math.min(960, src.naturalWidth);
      canvas.height = Math.round((canvas.width * src.naturalHeight) / src.naturalWidth);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    } else {
      // Built-in offline Chroma Key calibration scene
      canvas.width = 720;
      canvas.height = 460;
      ctx.fillStyle = '#00D13B';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Draw crisp foreground subject
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(260, 140, 200, 220, 28);
      ctx.fill();
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(360, 130, 68, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CENA DEMO CHROMA KEY', 360, 415);
    }

    if (config.enabled) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyChromaKeyToImageData(imgData, config);
      ctx.putImageData(imgData, 0, 0);
    }

    if (backdropMode === 'solid') {
      const fg = document.createElement('canvas');
      fg.width = canvas.width;
      fg.height = canvas.height;
      fg.getContext('2d')?.drawImage(canvas, 0, 0);
      ctx.fillStyle = backdropColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(fg, 0, 0);
    }
  };

  useEffect(() => {
    const mf = imageMedia.find((m) => m.id === selectedMediaId);
    if (!mf) {
      sourceImgRef.current = null;
      drawSampleOrImage();
      return;
    }
    const url = URL.createObjectURL(mf.blob);
    const img = new Image();
    img.onload = () => {
      sourceImgRef.current = img;
      drawSampleOrImage();
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [selectedMediaId, mediaFiles.length]);

  useEffect(() => {
    drawSampleOrImage();
  }, [config, backdropMode, backdropColor]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!eyedropperActive || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) * canvas.width) / rect.width);
    const y = Math.floor(((e.clientY - rect.top) * canvas.height) / rect.height);

    // Sample from original image without chroma applied
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    if (!octx) return;

    if (sourceImgRef.current) {
      octx.drawImage(sourceImgRef.current, 0, 0, off.width, off.height);
    } else {
      octx.fillStyle = '#00D13B';
      octx.fillRect(0, 0, off.width, off.height);
    }

    const px = octx.getImageData(x, y, 1, 1).data;
    const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    setConfig((c) => ({ ...c, keyColor: hex }));
    setEyedropperActive(false);
  };

  const handleSaveResult = async (download: boolean) => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const filename = `chromakey_${Date.now()}.png`;
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
      setNotice('Recorte Chroma Key salvo no projeto e na Minha Galeria!');
    }, 'image/png');
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-3 pb-20 lg:pb-8 space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const m = await processImportedFile(file, file.name, 'images');
            if (m && m.kind === 'image') {
              await onImportMedia([m]);
              setSelectedMediaId(m.id);
            }
          }
          e.target.value = '';
        }}
      />

      <div className="rounded-xl bg-[#13161D] border border-white/8 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm sm:text-base font-bold text-white">Chroma Key Offline (Tela Verde / Azul)</h1>
          <p className="text-[11px] text-slate-400">
            Recorte de cor em tempo real por distância RGB e supressão de vazamento (Spill)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-7 px-2.5 rounded-lg bg-[#1A1E28] border border-white/12 text-[11px] font-semibold text-white hover:bg-white/10 inline-flex items-center gap-1 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            Carregar Imagem
          </button>
          <button
            onClick={() => handleSaveResult(false)}
            className="h-7 px-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Salvar
          </button>
          <button
            onClick={() => handleSaveResult(true)}
            className="h-7 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar PNG
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-[11px] text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-3 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <select
              value={selectedMediaId}
              onChange={(e) => setSelectedMediaId(e.target.value)}
              className="h-7 rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 text-[11px] text-white max-w-xs"
            >
              <option value="">Cena Demo Tela Verde (Offline)</option>
              {imageMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setEyedropperActive((v) => !v)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                eyedropperActive
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'bg-[#1A1E28] text-slate-200 hover:bg-white/10'
              }`}
            >
              <Pipette className="w-3.5 h-3.5" />
              {eyedropperActive ? 'Clique na cor...' : 'Conta-Gotas'}
            </button>
          </div>

          <div className="rounded-xl bg-checkerboard border border-white/10 overflow-hidden flex items-center justify-center p-2">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className={`max-h-[420px] w-auto object-contain ${
                eyedropperActive ? 'cursor-crosshair' : 'cursor-default'
              }`}
            />
          </div>
        </div>

        {/* Chroma Parameters */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-white/8">
            <span className="text-sm font-semibold text-white">Parâmetros Chroma Key</span>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="accent-amber-500"
              />
              Ativo
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-300">Cor Chave</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config.keyColor}
                onChange={(e) => setConfig({ ...config, keyColor: e.target.value })}
                className="w-10 h-9 rounded bg-transparent cursor-pointer"
              />
              <button
                onClick={() => setConfig({ ...config, keyColor: '#00D13B' })}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs cursor-pointer"
              >
                Verde
              </button>
              <button
                onClick={() => setConfig({ ...config, keyColor: '#0047FF' })}
                className="px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs cursor-pointer"
              >
                Azul
              </button>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Tolerância / Similaridade</span>
              <span className="font-mono">{config.similarity}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={90}
              value={config.similarity}
              onChange={(e) => setConfig({ ...config, similarity: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Suavização de Borda</span>
              <span className="font-mono">{config.smoothness}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              value={config.smoothness}
              onChange={(e) => setConfig({ ...config, smoothness: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Supressão de Vazamento (Spill)</span>
              <span className="font-mono">{config.spill}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.spill}
              onChange={(e) => setConfig({ ...config, spill: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div className="pt-2 border-t border-white/8 space-y-2">
            <label className="block text-xs text-slate-300">Substituição de Fundo</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setBackdropMode('transparent')}
                className={`py-2 rounded-lg text-xs font-medium cursor-pointer ${
                  backdropMode === 'transparent'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-[#1A1E28] text-slate-300'
                }`}
              >
                Transparente
              </button>
              <button
                onClick={() => setBackdropMode('solid')}
                className={`py-2 rounded-lg text-xs font-medium cursor-pointer ${
                  backdropMode === 'solid'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-[#1A1E28] text-slate-300'
                }`}
              >
                Cor Sólida
              </button>
            </div>
            {backdropMode === 'solid' && (
              <input
                type="color"
                value={backdropColor}
                onChange={(e) => setBackdropColor(e.target.value)}
                className="w-full h-9 rounded bg-transparent cursor-pointer"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
