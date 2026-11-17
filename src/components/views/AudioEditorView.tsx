import React, { useRef, useState } from 'react';
import {
  Play,
  Square,
  Music,
  Volume2,
  VolumeX,
  Plus,
  Download,
  Trash2,
  Sliders,
  Disc,
  Upload,
} from 'lucide-react';
import { AudioClip, GalleryItem, MediaFile, StudioProject } from '../../types/studio';
import {
  decodeAudioBlob,
  generateLocalSynthLoopWav,
  getAudioContext,
  mixAudioClipsOffline,
} from '../../utils/audioEngine';
import { ALL_ACCEPTED_EXTENSIONS, formatDuration, processImportedFile } from '../../utils/mediaImporter';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface AudioEditorViewProps {
  project: StudioProject;
  mediaFiles: MediaFile[];
  onUpdateProject: (updated: StudioProject) => void;
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

export const AudioEditorView: React.FC<AudioEditorViewProps> = ({
  project,
  mediaFiles,
  onUpdateProject,
  onImportMedia,
  onSaveToGallery,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeNodesRef = useRef<AudioBufferSourceNode[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    project.audioClips[0]?.id || null
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [renderingWav, setRenderingWav] = useState(false);

  const trimDragRef = useRef<{
    active: boolean;
    clipId: string;
    mode: 'left' | 'right' | 'window';
    startClientX: number;
    origTrimStart: number;
    origDuration: number;
    sourceDuration: number;
    laneWidthPx: number;
  }>({
    active: false,
    clipId: '',
    mode: 'left',
    startClientX: 0,
    origTrimStart: 0,
    origDuration: 1,
    sourceDuration: 1,
    laneWidthPx: 400,
  });

  const handleTrimPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = trimDragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startClientX;
    const dt = (dx / Math.max(120, drag.laneWidthPx)) * drag.sourceDuration;

    if (drag.mode === 'left') {
      const origEnd = drag.origTrimStart + drag.origDuration;
      const nextTrimStart = Number(
        Math.max(0, Math.min(origEnd - 0.2, drag.origTrimStart + dt)).toFixed(2)
      );
      const nextDuration = Number(Math.max(0.2, origEnd - nextTrimStart).toFixed(2));
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((c) =>
          c.id === drag.clipId ? { ...c, trimStart: nextTrimStart, duration: nextDuration } : c
        ),
      });
    } else if (drag.mode === 'right') {
      const maxDur = Math.max(0.2, drag.sourceDuration - drag.origTrimStart);
      const nextDuration = Number(
        Math.max(0.2, Math.min(maxDur, drag.origDuration + dt)).toFixed(2)
      );
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((c) =>
          c.id === drag.clipId ? { ...c, duration: nextDuration } : c
        ),
      });
    } else {
      const maxStart = Math.max(0, drag.sourceDuration - drag.origDuration);
      const nextTrimStart = Number(
        Math.max(0, Math.min(maxStart, drag.origTrimStart + dt)).toFixed(2)
      );
      onUpdateProject({
        ...project,
        audioClips: project.audioClips.map((c) =>
          c.id === drag.clipId ? { ...c, trimStart: nextTrimStart } : c
        ),
      });
    }
  };

  const handleTrimPointerUp = () => {
    trimDragRef.current.active = false;
  };

  const audioMedia = mediaFiles.filter((m) => m.kind === 'audio');
  const selectedClip = project.audioClips.find((c) => c.id === selectedClipId) || null;

  const stopPlayback = () => {
    activeNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // ignore stopped nodes
      }
    });
    activeNodesRef.current = [];
    setIsPlaying(false);
  };

  const startPlayback = async () => {
    stopPlayback();
    if (project.audioClips.length === 0) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const mediaMap = new Map(mediaFiles.map((m) => [m.id, m]));
    const hasSolo = project.audioClips.some((c) => c.solo);
    const active = project.audioClips.filter((c) => !c.muted && (!hasSolo || c.solo));

    if (active.length === 0) return;

    const decodedItems: Array<{ clip: AudioClip; buffer: AudioBuffer }> = [];
    for (const clip of active) {
      const mf = mediaMap.get(clip.mediaId);
      if (!mf) continue;
      const { buffer } = await decodeAudioBlob(mf.blob);
      decodedItems.push({ clip, buffer });
    }
    if (decodedItems.length === 0) return;

    setIsPlaying(true);
    const now = ctx.currentTime + 0.05;
    let longestEnd = 0;

    for (const { clip, buffer } of decodedItems) {

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clip.speed;

      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 120;
      bass.gain.value = clip.eqBass;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.gain.value = clip.eqMid;

      const treble = ctx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 6000;
      treble.gain.value = clip.eqTreble;

      const gain = ctx.createGain();
      const startAt = now + clip.startTime;
      const playDur = clip.duration / Math.max(0.25, clip.speed);

      gain.gain.setValueAtTime(clip.fadeIn > 0.01 ? 0.001 : clip.gain, startAt);
      if (clip.fadeIn > 0.01) {
        gain.gain.linearRampToValueAtTime(clip.gain, startAt + Math.min(clip.fadeIn, playDur * 0.45));
      }
      if (clip.fadeOut > 0.01) {
        gain.gain.setValueAtTime(clip.gain, startAt + Math.max(0, playDur - clip.fadeOut));
        gain.gain.linearRampToValueAtTime(0.001, startAt + playDur);
      }

      src.connect(bass);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(gain);
      gain.connect(ctx.destination);

      src.start(startAt, clip.trimStart, clip.duration);
      activeNodesRef.current.push(src);
      longestEnd = Math.max(longestEnd, clip.startTime + playDur);
    }

    window.setTimeout(() => {
      setIsPlaying(false);
    }, Math.ceil(longestEnd * 1000) + 120);
  };

  const addMediaClip = async (mf: MediaFile) => {
    let peaks: number[] = Array.from({ length: 64 }, () => 0.35);
    let dur = mf.duration || 4;
    try {
      const decoded = await decodeAudioBlob(mf.blob);
      peaks = decoded.peaks;
      dur = decoded.duration;
    } catch {
      // fallback peaks
    }

    const newClip: AudioClip = {
      id: `aclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      mediaId: mf.id,
      name: mf.name,
      startTime: 0,
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
      lastTool: 'audio',
      audioClips: [...project.audioClips, newClip],
    });
    setSelectedClipId(newClip.id);
  };

  const handleGenerateSynth = async (
    style: 'batida-eletronica' | 'trilha-ambiente' | 'efeito-arcade',
    label: string
  ) => {
    setStatusMsg(`Sintetizando ${label} localmente...`);
    const wavBlob = await generateLocalSynthLoopWav(style, 112, 2);
    const mf = await processImportedFile(
      wavBlob,
      `${label.toLowerCase().replace(/\s+/g, '_')}.wav`,
      'music'
    );
    if (mf) {
      await onImportMedia([mf]);
      await addMediaClip(mf);
      setStatusMsg(`${label} criado e adicionado à faixa de áudio.`);
    }
  };

  const handleDirectUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imported: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const m = await processImportedFile(file, file.name, 'music');
      if (m && m.kind === 'audio') imported.push(m);
    }
    if (imported.length > 0) {
      await onImportMedia(imported);
      await addMediaClip(imported[0]);
    }
  };

  const updateSelected = (patch: Partial<AudioClip>) => {
    if (!selectedClipId) return;
    onUpdateProject({
      ...project,
      audioClips: project.audioClips.map((c) =>
        c.id === selectedClipId ? { ...c, ...patch } : c
      ),
    });
  };

  const handleExportWav = async () => {
    if (project.audioClips.length === 0) return;
    setRenderingWav(true);
    try {
      const mediaMap = new Map(mediaFiles.map((m) => [m.id, m.blob]));
      const wav = await mixAudioClipsOffline(project.audioClips, mediaMap);
      const filename = `${project.name.replace(/\s+/g, '_')}_mix.wav`;
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
      setStatusMsg('Mixagem WAV exportada e salva em Minha Galeria!');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Erro ao mixar áudio.');
    } finally {
      setRenderingWav(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          void handleDirectUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Header Controls */}
      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Editor de Áudio e Música Offline</h1>
          <p className="text-xs text-slate-400">
            Forma de onda Web Audio API · Corte, Fade, Equalizador 3 Bandas e Exportação WAV
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isPlaying ? (
            <button
              onClick={startPlayback}
              className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              PLAY MIX
            </button>
          ) : (
            <button
              onClick={stopPlayback}
              className="min-h-[40px] px-4 rounded-xl bg-red-500 hover:bg-red-400 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              STOP
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-3.5 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-white hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-amber-400" />
            Importar Áudio
          </button>
          <button
            onClick={handleExportWav}
            disabled={renderingWav || project.audioClips.length === 0}
            className="min-h-[40px] px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {renderingWav ? 'Mixando...' : 'Exportar WAV'}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-xl bg-[#13161D] border border-cyan-500/30 px-4 py-2.5 text-xs text-cyan-200">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-4 items-start">
        {/* Left: Audio Library & Local Synth Generator */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4">
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Disc className="w-4 h-4 text-cyan-400" />
              Sintetizador Local de Loops
            </h2>
            <div className="grid grid-cols-1 gap-1.5">
              <button
                onClick={() => handleGenerateSynth('batida-eletronica', 'Batida Eletrônica')}
                className="min-h-[38px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-3 text-xs text-left text-slate-200 cursor-pointer"
              >
                + Gerar Batida Eletrônica (WAV)
              </button>
              <button
                onClick={() => handleGenerateSynth('trilha-ambiente', 'Trilha Ambiente')}
                className="min-h-[38px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-3 text-xs text-left text-slate-200 cursor-pointer"
              >
                + Gerar Trilha Ambiente (WAV)
              </button>
              <button
                onClick={() => handleGenerateSynth('efeito-arcade', 'Efeito Arcade')}
                className="min-h-[38px] rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/8 px-3 text-xs text-left text-slate-200 cursor-pointer"
              >
                + Gerar Efeito Arcade (WAV)
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-white/8 space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">Músicas Importadas</h3>
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {audioMedia.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  Importe MP3, WAV, AAC, OGG ou M4A.
                </p>
              ) : (
                audioMedia.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => addMediaClip(m)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg bg-[#1A1E28] hover:bg-white/10 p-2.5 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Music className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{m.name}</p>
                        <p className="text-[10px] font-mono text-slate-400">
                          {formatDuration(m.duration)}
                        </p>
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-amber-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center: Multi-Track Waveform Lanes */}
        <div
          onPointerMove={handleTrimPointerMove}
          onPointerUp={handleTrimPointerUp}
          onPointerCancel={handleTrimPointerUp}
          className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3 min-h-[360px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-300">
              Faixas de Áudio ({project.audioClips.length})
            </h2>
            <span className="text-[11px] text-amber-300/90">
              Arraste as alças laterais na onda para cortar o áudio
            </span>
          </div>
          {project.audioClips.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Music className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-300">Nenhuma faixa na linha do tempo.</p>
              <p className="text-xs text-slate-400">
                Importe uma música ou gere um loop sintetizado ao lado.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {project.audioClips.map((clip) => {
                const active = clip.id === selectedClipId;
                const srcTotal = Math.max(0.2, clip.sourceDuration || clip.duration);
                const startPct = Math.max(0, Math.min(98, (clip.trimStart / srcTotal) * 100));
                const endPct = Math.max(
                  startPct + 2,
                  Math.min(100, ((clip.trimStart + clip.duration) / srcTotal) * 100)
                );
                const trimEnd = Math.min(srcTotal, clip.trimStart + clip.duration);

                return (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClipId(clip.id)}
                    className={`rounded-xl border p-3 space-y-2 transition-colors cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-white/10 bg-[#1A1E28] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-white truncate block">{clip.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          Corte: {clip.trimStart.toFixed(2)}s → {trimEnd.toFixed(2)}s (Dur: {clip.duration.toFixed(2)}s / Orig: {srcTotal.toFixed(1)}s)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateProject({
                              ...project,
                              audioClips: project.audioClips.map((c) =>
                                c.id === clip.id ? { ...c, muted: !c.muted } : c
                              ),
                            });
                          }}
                          className={`p-1.5 rounded-lg cursor-pointer ${
                            clip.muted ? 'bg-red-500/20 text-red-400' : 'text-slate-300 hover:bg-white/10'
                          }`}
                          title="Silenciar"
                        >
                          {clip.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateProject({
                              ...project,
                              audioClips: project.audioClips.filter((c) => c.id !== clip.id),
                            });
                            if (selectedClipId === clip.id) setSelectedClipId(null);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Interactive Drag-to-Trim Waveform Bars */}
                    <div className="h-16 rounded-lg bg-[#0B0D11] relative overflow-hidden select-none touch-none border border-white/8">
                      <div className="absolute inset-0 px-2 flex items-center gap-[2px] pointer-events-none">
                        {clip.peaks.map((pk, idx) => (
                          <div
                            key={idx}
                            style={{ height: `${Math.max(12, Math.round(pk * 100))}%` }}
                            className={`flex-1 rounded-full ${
                              clip.muted
                                ? 'bg-slate-700'
                                : active
                                ? 'bg-amber-400'
                                : 'bg-cyan-500/75'
                            }`}
                          />
                        ))}
                      </div>

                      {/* Dimmed trimmed-out left region */}
                      {startPct > 0 && (
                        <div
                          style={{ width: `${startPct}%` }}
                          className="absolute left-0 top-0 bottom-0 bg-black/70 pointer-events-none"
                        />
                      )}
                      {/* Dimmed trimmed-out right region */}
                      {endPct < 100 && (
                        <div
                          style={{ left: `${endPct}%`, right: 0 }}
                          className="absolute top-0 bottom-0 bg-black/70 pointer-events-none"
                        />
                      )}

                      {/* Active draggable cut window */}
                      <div
                        style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                          const lane = e.currentTarget.parentElement;
                          trimDragRef.current = {
                            active: true,
                            clipId: clip.id,
                            mode: 'window',
                            startClientX: e.clientX,
                            origTrimStart: clip.trimStart,
                            origDuration: clip.duration,
                            sourceDuration: srcTotal,
                            laneWidthPx: lane?.getBoundingClientRect().width || 400,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        className="absolute top-0 bottom-0 border-y-2 border-amber-400/90 bg-amber-500/10 cursor-grab active:cursor-grabbing"
                      >
                        {/* Left trim handle */}
                        <div
                          title="Arraste para cortar início"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setSelectedClipId(clip.id);
                            const lane = e.currentTarget.parentElement?.parentElement;
                            trimDragRef.current = {
                              active: true,
                              clipId: clip.id,
                              mode: 'left',
                              startClientX: e.clientX,
                              origTrimStart: clip.trimStart,
                              origDuration: clip.duration,
                              sourceDuration: srcTotal,
                              laneWidthPx: lane?.getBoundingClientRect().width || 400,
                            };
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          className="absolute -left-1.5 top-0 bottom-0 w-3.5 bg-amber-400 hover:bg-amber-300 rounded-l cursor-ew-resize touch-none flex items-center justify-center shadow"
                        >
                          <span className="w-0.5 h-6 bg-slate-950 rounded" />
                        </div>

                        {/* Right trim handle */}
                        <div
                          title="Arraste para cortar fim"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setSelectedClipId(clip.id);
                            const lane = e.currentTarget.parentElement?.parentElement;
                            trimDragRef.current = {
                              active: true,
                              clipId: clip.id,
                              mode: 'right',
                              startClientX: e.clientX,
                              origTrimStart: clip.trimStart,
                              origDuration: clip.duration,
                              sourceDuration: srcTotal,
                              laneWidthPx: lane?.getBoundingClientRect().width || 400,
                            };
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          className="absolute -right-1.5 top-0 bottom-0 w-3.5 bg-amber-400 hover:bg-amber-300 rounded-r cursor-ew-resize touch-none flex items-center justify-center shadow"
                        >
                          <span className="w-0.5 h-6 bg-slate-950 rounded" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Audio Inspector (Gain, Trim, Fade, 3-Band EQ) */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3.5">
          {selectedClip ? (
            <>
              <div className="flex items-center gap-2 pb-2 border-b border-white/8">
                <Sliders className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-semibold text-white truncate">{selectedClip.name}</h3>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Ganho (Volume)</span>
                  <span className="font-mono text-white">{Math.round(selectedClip.gain * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedClip.gain}
                  onChange={(e) => updateSelected({ gain: Number(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Corte Início (s)</label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, selectedClip.sourceDuration - 0.2)}
                    step={0.1}
                    value={selectedClip.trimStart}
                    onChange={(e) => updateSelected({ trimStart: Math.max(0, Number(e.target.value)) })}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Duração (s)</label>
                  <input
                    type="number"
                    min={0.2}
                    max={selectedClip.sourceDuration}
                    step={0.1}
                    value={selectedClip.duration}
                    onChange={(e) =>
                      updateSelected({
                        duration: Math.max(0.2, Math.min(selectedClip.sourceDuration, Number(e.target.value))),
                      })
                    }
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Fade In (s)</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={selectedClip.fadeIn}
                    onChange={(e) => updateSelected({ fadeIn: Math.max(0, Number(e.target.value)) })}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Fade Out (s)</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={selectedClip.fadeOut}
                    onChange={(e) => updateSelected({ fadeOut: Math.max(0, Number(e.target.value)) })}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Velocidade / Pitch</span>
                  <span className="font-mono text-white">{selectedClip.speed.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={selectedClip.speed}
                  onChange={(e) => updateSelected({ speed: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div className="pt-2 border-t border-white/8 space-y-2.5">
                <p className="text-[11px] font-semibold text-slate-300">Equalizador 3 Bandas (dB)</p>
                {[
                  { key: 'eqBass', label: 'Graves (120Hz)', val: selectedClip.eqBass },
                  { key: 'eqMid', label: 'Médios (1kHz)', val: selectedClip.eqMid },
                  { key: 'eqTreble', label: 'Agudos (6kHz)', val: selectedClip.eqTreble },
                ].map((band) => (
                  <div key={band.key}>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>{band.label}</span>
                      <span className="font-mono text-white">
                        {band.val > 0 ? `+${band.val}` : band.val} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={band.val}
                      onChange={(e) =>
                        updateSelected({ [band.key]: Number(e.target.value) } as Partial<AudioClip>)
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 py-10 text-center">
              Selecione uma faixa de áudio para editar volume, corte, fade e equalização.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
