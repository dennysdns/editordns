import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RotateCcw, Download, CheckCircle2 } from 'lucide-react';
import {
  DEFAULT_EFFECTS,
  EffectsConfig,
  GalleryItem,
  MediaFile,
  ParticlePreset,
  StudioProject,
} from '../../types/studio';
import {
  applyPostPixelEffects,
  buildCssFilterString,
  drawParticlesOverlay,
  renderAnimationFrameToCanvas,
} from '../../utils/canvasRenderer';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface SpecialEffectsViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  imageCache: Map<string, HTMLImageElement>;
  onUpdateProject: (updated: StudioProject) => void;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

export const SpecialEffectsView: React.FC<SpecialEffectsViewProps> = ({
  project,
  mediaFiles,
  imageCache,
  onUpdateProject,
  onSaveToGallery,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [effects, setEffects] = useState<EffectsConfig>({ ...DEFAULT_EFFECTS });
  const [particles, setParticles] = useState<ParticlePreset>(project.particles || 'none');
  const [sourceMediaId, setSourceMediaId] = useState<string>('');
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const imageMedia = mediaFiles.filter((m) => m.kind === 'image');

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 90);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const aspect = Math.max(0.25, project.width / Math.max(1, project.height));
    const maxDim = 960;
    const w = aspect >= 1 ? maxDim : Math.round(maxDim * aspect);
    const h = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim;
    canvas.width = w;
    canvas.height = h;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    if (!octx) return;

    if (sourceMediaId && imageCache.has(sourceMediaId)) {
      const img = imageCache.get(sourceMediaId)!;
      octx.fillStyle = '#0B0D11';
      octx.fillRect(0, 0, w, h);
      const fit = Math.min(w / Math.max(1, img.naturalWidth), h / Math.max(1, img.naturalHeight));
      const dw = img.naturalWidth * fit;
      const dh = img.naturalHeight * fit;
      octx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const projCanvas = document.createElement('canvas');
      projCanvas.width = project.width;
      projCanvas.height = project.height;
      const pctx = projCanvas.getContext('2d');
      if (pctx) {
        renderAnimationFrameToCanvas(pctx, project, tick % Math.max(1, project.frames.length), imageCache);
        octx.drawImage(projCanvas, 0, 0, w, h);
      }
    }

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.filter = buildCssFilterString(effects);
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    applyPostPixelEffects(ctx, w, h, effects, tick);
    drawParticlesOverlay(ctx, particles, w, h, tick);
  }, [effects, particles, sourceMediaId, project, imageCache, tick]);

  const applyToActiveProject = () => {
    onUpdateProject({
      ...project,
      particles,
      layers: project.layers.map((l) => ({ ...l, effects: { ...effects } })),
      videoClips: project.videoClips.map((c) => ({ ...c, effects: { ...effects } })),
    });
    setNotice('Efeitos especiais e partículas aplicados ao projeto atual!');
  };

  const handleExportFrame = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const filename = `efeitos_${Date.now()}.png`;
      triggerBlobDownload(blob, filename);
      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'image',
        mimeType: 'image/png',
        size: blob.size,
        width: canvasRef.current?.width || 540,
        height: canvasRef.current?.height || 960,
        blob,
        thumbnailDataUrl: canvasRef.current?.toDataURL('image/png'),
        createdAt: Date.now(),
      });
      setNotice('Quadro com efeitos baixado e salvo na Minha Galeria!');
    }, 'image/png');
  };

  const applyPreset = (preset: 'cinema' | 'glitch' | 'noir' | 'vintage') => {
    if (preset === 'cinema') {
      setEffects({ ...DEFAULT_EFFECTS, contrast: 118, saturation: 112, vignette: 45 });
    } else if (preset === 'glitch') {
      setEffects({ ...DEFAULT_EFFECTS, contrast: 120, glitch: 55, grain: 25 });
    } else if (preset === 'noir') {
      setEffects({ ...DEFAULT_EFFECTS, grayscale: 100, contrast: 135, vignette: 60, grain: 20 });
    } else {
      setEffects({ ...DEFAULT_EFFECTS, sepia: 70, contrast: 110, vignette: 40, grain: 30 });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-3 pb-20 lg:pb-6 space-y-3">
      <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-bold text-white">Laboratório de Efeitos Especiais</h1>
          <p className="text-[11px] text-slate-400">
            Filtros de imagem, distorção Glitch RGB, pixelização, granulação, vinheta e partículas animadas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setEffects({ ...DEFAULT_EFFECTS });
              setParticles('none');
            }}
            className="h-7 px-2.5 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-[11px] font-medium text-slate-200 inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Resetar
          </button>
          <button
            onClick={applyToActiveProject}
            className="h-7 px-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Aplicar ao Projeto
          </button>
          <button
            onClick={handleExportFrame}
            className="h-7 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Imagem FX
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-[11px] text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={sourceMediaId}
              onChange={(e) => setSourceMediaId(e.target.value)}
              className="h-7 rounded-lg bg-[#0B0D11] border border-white/12 px-2 text-[11px] text-white"
            >
              <option value="">Cena do Projeto Atual</option>
              {imageMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-1">
              {[
                { id: 'cinema', label: 'Cinema' },
                { id: 'glitch', label: 'Glitch Digital' },
                { id: 'noir', label: 'Noir P&B' },
                { id: 'vintage', label: 'Retrô Sépia' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id as 'cinema' | 'glitch' | 'noir' | 'vintage')}
                  className="h-7 px-2 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-[11px] text-slate-200 cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-[#0B0D11] border border-white/10 overflow-hidden p-2 flex items-center justify-center">
            <canvas ref={canvasRef} className="max-h-[420px] w-auto max-w-full h-auto mx-auto block rounded-lg" />
          </div>
        </div>

        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-2.5 max-h-[540px] overflow-y-auto">
          <h3 className="text-xs font-semibold text-white flex items-center gap-1.5 pb-1.5 border-b border-white/8">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Controles de Efeitos
          </h3>

          <div>
            <label className="block text-xs text-slate-300 mb-1">Partículas Animadas</label>
            <select
              value={particles}
              onChange={(e) => setParticles(e.target.value as ParticlePreset)}
              className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white"
            >
              <option value="none">Sem Partículas</option>
              <option value="rain">Chuva</option>
              <option value="snow">Neve</option>
              <option value="sparks">Faíscas de Fogo</option>
              <option value="confetti">Confete Colorido</option>
            </select>
          </div>

          {[
            { key: 'brightness', label: 'Brilho', min: 20, max: 200, unit: '%' },
            { key: 'contrast', label: 'Contraste', min: 20, max: 200, unit: '%' },
            { key: 'saturation', label: 'Saturação', min: 0, max: 200, unit: '%' },
            { key: 'blur', label: 'Desfoque (Blur)', min: 0, max: 16, unit: 'px' },
            { key: 'hueRotate', label: 'Matiz (Hue)', min: -180, max: 180, unit: '°' },
            { key: 'sepia', label: 'Sépia', min: 0, max: 100, unit: '%' },
            { key: 'grayscale', label: 'Preto e Branco', min: 0, max: 100, unit: '%' },
            { key: 'pixelate', label: 'Pixelização', min: 1, max: 24, unit: 'px' },
            { key: 'glitch', label: 'Glitch RGB', min: 0, max: 100, unit: '%' },
            { key: 'vignette', label: 'Vinheta', min: 0, max: 100, unit: '%' },
            { key: 'grain', label: 'Granulação Filme', min: 0, max: 100, unit: '%' },
          ].map((ctrl) => {
            const val = effects[ctrl.key as keyof EffectsConfig];
            return (
              <div key={ctrl.key}>
                <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                  <span>{ctrl.label}</span>
                  <span className="font-mono text-white">
                    {val}
                    {ctrl.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  value={val}
                  onChange={(e) =>
                    setEffects((prev) => ({
                      ...prev,
                      [ctrl.key]: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
