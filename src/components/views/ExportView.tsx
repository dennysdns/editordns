import React, { useState } from 'react';
import { Download, Film, Image as ImageIcon, Music, CheckCircle2 } from 'lucide-react';
import { GalleryItem, MediaFile, StudioProject } from '../../types/studio';
import {
  ensureStudioBackgroundLoaded,
  renderAnimationFrameToCanvas,
} from '../../utils/canvasRenderer';
import { mixAudioClipsOffline } from '../../utils/audioEngine';
import { exportProjectVideoOffline, triggerBlobDownload } from '../../utils/videoExporter';
import { formatBytes } from '../../utils/mediaImporter';

import { DecodedGif } from '../../utils/gifDecoder';

interface ExportViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  imageCache: Map<string, HTMLImageElement>;
  gifCache: Map<string, DecodedGif>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

export const ExportView: React.FC<ExportViewProps> = ({
  project,
  mediaFiles,
  imageCache,
  gifCache,
  onSaveToGallery,
}) => {
  const [source, setSource] = useState<'animation' | 'video'>(
    project.videoClips.length > 0 ? 'video' : 'animation'
  );
  const [fps, setFps] = useState(project.fps);
  const [format, setFormat] = useState<'webm' | 'mp4'>('mp4');
  const [bitrateMbps, setBitrateMbps] = useState(5);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [lastExport, setLastExport] = useState<{
    name: string;
    size: number;
    blob: Blob;
    kind: 'video' | 'image' | 'audio';
  } | null>(null);

  const getExportDims = () => ({ width: 1080, height: 1920 });

  const handleExportVideo = async () => {
    setRendering(true);
    setProgress(0);
    setStatusText('Preparando renderizador local...');
    try {
      const dims = getExportDims();
      const result = await exportProjectVideoOffline(project, mediaFiles, imageCache, {
        source,
        width: dims.width,
        height: dims.height,
        fps,
        videoBitsPerSecond: bitrateMbps * 1_000_000,
        format,
        gifCache,
        onProgress: (pct, text) => {
          setProgress(pct);
          setStatusText(text);
        },
      });

      const filename = `${project.name.replace(/\s+/g, '_')}.${result.extension}`;
      triggerBlobDownload(result.blob, filename);

      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'video',
        mimeType: result.mimeType,
        size: result.blob.size,
        width: dims.width,
        height: dims.height,
        duration: result.durationSec,
        blob: result.blob,
        thumbnailDataUrl: project.thumbnailDataUrl,
        createdAt: Date.now(),
      });

      setLastExport({
        name: filename,
        size: result.blob.size,
        blob: result.blob,
        kind: 'video',
      });
      setStatusText(`Renderização concluída (${result.extension.toUpperCase()}) e salva na Minha Galeria.`);
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : 'Falha na renderização local.');
    } finally {
      setRendering(false);
    }
  };

  const handleExportPngFrame = async () => {
    await ensureStudioBackgroundLoaded();
    const off = document.createElement('canvas');
    off.width = 1080;
    off.height = 1920;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    renderAnimationFrameToCanvas(ctx, project, 0, imageCache);
    off.toBlob(async (blob) => {
      if (!blob) return;
      const filename = `${project.name.replace(/\s+/g, '_')}_quadro1.png`;
      triggerBlobDownload(blob, filename);
      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'image',
        mimeType: 'image/png',
        size: blob.size,
        width: project.width,
        height: project.height,
        blob,
        thumbnailDataUrl: off.toDataURL('image/png'),
        createdAt: Date.now(),
      });
      setLastExport({ name: filename, size: blob.size, blob, kind: 'image' });
      setStatusText('Quadro PNG exportado e salvo na Minha Galeria!');
    }, 'image/png');
  };

  const handleExportWav = async () => {
    if (project.audioClips.length === 0) {
      setStatusText('Adicione clipes no Editor de Áudio para exportar WAV.');
      return;
    }
    setRendering(true);
    try {
      const map = new Map(mediaFiles.map((m) => [m.id, m.blob]));
      const wav = await mixAudioClipsOffline(project.audioClips, map);
      const filename = `${project.name.replace(/\s+/g, '_')}_audio.wav`;
      triggerBlobDownload(wav, filename);
      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'audio',
        mimeType: 'audio/wav',
        size: wav.size,
        blob: wav,
        createdAt: Date.now(),
      });
      setLastExport({ name: filename, size: wav.size, blob: wav, kind: 'audio' });
      setStatusText('Áudio WAV mixado offline e salvo na Minha Galeria!');
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : 'Erro ao exportar áudio.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10 space-y-6">
      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white">Exportar Vídeo, Imagem e Áudio</h1>
          <p className="text-xs text-slate-400 mt-1">
            Renderização 100% local via Canvas 2D + MediaRecorder + Web Audio Offline
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Origem da Cena</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as 'animation' | 'video')}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white"
            >
              <option value="animation">Estúdio de Animação ({project.frames.length} quadros)</option>
              <option value="video">Linha do Tempo do Editor de Vídeo ({project.videoClips.length} clipes)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Resolução de Saída</label>
            <div className="w-full rounded-xl bg-[#0B0D11] border border-amber-500/30 px-3 py-2.5 text-sm text-amber-300 font-mono">
              9:16 Vertical Único (1080×1920)
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Taxa de Quadros (FPS)</label>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white font-mono"
            >
              <option value={12}>12 FPS</option>
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Formato Preferencial</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white"
            >
              <option value="mp4">MP4 (quando suportado pelo dispositivo) / WebM</option>
              <option value="webm">WebM (VP9/VP8 Alta Compatibilidade)</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-300 mb-1">
            <span>Qualidade de Vídeo (Bitrate)</span>
            <span className="font-mono text-white">{bitrateMbps} Mbps</span>
          </div>
          <input
            type="range"
            min={2}
            max={12}
            step={1}
            value={bitrateMbps}
            onChange={(e) => setBitrateMbps(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>

        {(() => {
          const activeAudioCount = project.audioClips.filter((c) => !c.muted).length;
          const videoAudioCount =
            source === 'video'
              ? project.videoClips.filter((v) => v.kind === 'video' && v.volume > 0).length
              : 0;
          const totalSources = activeAudioCount + videoAudioCount;
          return (
            <div
              className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${
                totalSources > 0
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-[#0B0D11] border-white/10 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>
                  {totalSources > 0
                    ? `Exportação com Áudio Ativada: ${activeAudioCount} faixa(s) de áudio/música${
                        videoAudioCount > 0 ? ` + ${videoAudioCount} vídeo(s) com som` : ''
                      }`
                    : 'Nenhuma faixa de áudio ativa no momento (adicione músicas no Editor de Vídeo ou Áudio).'}
                </span>
              </div>
              <span className="font-mono text-[11px] opacity-85">Mixagem Web Audio</span>
            </div>
          );
        })()}

        {rendering && (
          <div className="space-y-2 rounded-xl bg-[#0B0D11] border border-white/10 p-4">
            <div className="flex justify-between text-xs text-slate-200">
              <span>{statusText}</span>
              <span className="font-mono text-amber-400">{progress}%</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div
                style={{ width: `${progress}%` }}
                className="h-full bg-amber-500 transition-all duration-150"
              />
            </div>
          </div>
        )}

        {!rendering && statusText && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusText}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            onClick={handleExportVideo}
            disabled={rendering}
            className="min-h-[48px] rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-xs font-bold text-slate-950 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Film className="w-4 h-4" />
            Exportar Vídeo
          </button>
          <button
            onClick={handleExportPngFrame}
            disabled={rendering}
            className="min-h-[48px] rounded-xl bg-[#1A1E28] hover:bg-white/10 border border-white/12 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <ImageIcon className="w-4 h-4 text-cyan-400" />
            Exportar Quadro PNG
          </button>
          <button
            onClick={handleExportWav}
            disabled={rendering}
            className="min-h-[48px] rounded-xl bg-[#1A1E28] hover:bg-white/10 border border-white/12 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Music className="w-4 h-4 text-emerald-400" />
            Exportar Áudio WAV
          </button>
        </div>

        {lastExport && (
          <div className="rounded-xl bg-[#1A1E28] border border-white/10 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{lastExport.name}</p>
              <p className="text-[11px] font-mono text-slate-400">
                Tamanho: {formatBytes(lastExport.size)}
              </p>
            </div>
            <button
              onClick={() => triggerBlobDownload(lastExport.blob, lastExport.name)}
              className="px-3.5 py-2 rounded-lg bg-amber-500 text-xs font-bold text-slate-950 hover:bg-amber-400 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar Novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
