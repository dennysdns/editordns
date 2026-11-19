import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Film,
  FolderPlus,
  Image as ImageIcon,
  Images,
  Music,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { GalleryItem, MediaFile } from '../../types/studio';
import {
  ALL_ACCEPTED_EXTENSIONS,
  formatBytes,
  formatDuration,
  processImportedFile,
} from '../../utils/mediaImporter';
import {
  AudioTargetFormat,
  ConvertResult,
  convertAudioOffline,
  convertImageOffline,
  convertVideoOffline,
  ImageTargetFormat,
  VideoTargetFormat,
} from '../../utils/mediaConverter';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface ConverterViewProps {
  mediaFiles: MediaFile[];
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onDeleteMedia: (ids: string[]) => Promise<void>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
}

type ConverterTab = 'audio' | 'image' | 'video';

export const ConverterView: React.FC<ConverterViewProps> = ({
  mediaFiles,
  onImportMedia,
  onDeleteMedia,
  onSaveToGallery,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<ConverterTab>('audio');
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  // Audio conversion options
  const [audioFormat, setAudioFormat] = useState<AudioTargetFormat>('wav');
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100);
  const [channels, setChannels] = useState<1 | 2>(2);

  // Image conversion options
  const [imageFormat, setImageFormat] = useState<ImageTargetFormat>('png');
  const [imageQuality, setImageQuality] = useState(0.92);
  const [maxDimension, setMaxDimension] = useState<number>(0);
  const [jpgBgColor, setJpgBgColor] = useState('#000000');
  const [videoSeekSec, setVideoSeekSec] = useState(0);

  // Video conversion options
  const [videoFormat, setVideoFormat] = useState<VideoTargetFormat>('mp4');
  const [videoMaxHeight, setVideoMaxHeight] = useState<number>(0);
  const [videoFps, setVideoFps] = useState<24 | 30>(30);
  const [videoBitrateMbps, setVideoBitrateMbps] = useState<number>(6);
  const [includeVideoAudio, setIncludeVideoAudio] = useState(true);
  const [imageDurationSec, setImageDurationSec] = useState(4);

  const compatibleFiles = useMemo(() => {
    if (tab === 'audio') {
      return mediaFiles.filter((m) => m.kind === 'audio' || m.kind === 'video');
    }
    if (tab === 'image') {
      return mediaFiles.filter((m) => m.kind === 'image' || m.kind === 'video');
    }
    return mediaFiles.filter((m) => m.kind === 'video' || m.kind === 'image');
  }, [mediaFiles, tab]);

  const selectedFile = useMemo(() => {
    return (
      compatibleFiles.find((m) => m.id === selectedMediaId) || compatibleFiles[0] || null
    );
  }, [compatibleFiles, selectedMediaId]);

  useEffect(() => {
    if (!resultUrl) return;
    return () => {
      URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorText(null);
    const imported: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const processed = await processImportedFile(file, file.name, 'internal');
      if (processed) imported.push(processed);
    }
    if (imported.length > 0) {
      await onImportMedia(imported);
      const first = imported[0];
      setSelectedMediaId(first.id);
      if (first.kind === 'audio') setTab('audio');
      else if (first.kind === 'image') setTab('image');
      else if (first.kind === 'video') setTab('video');
      setResult(null);
      setResultUrl(null);
    } else {
      setErrorText('Formato de arquivo não reconhecido para importação local.');
    }
  };

  const handleConvert = async () => {
    if (!selectedFile) return;
    setConverting(true);
    setProgress(0);
    setErrorText(null);
    setSavedFeedback(null);
    setStatusText('Iniciando conversão local...');
    setResult(null);
    setResultUrl(null);

    try {
      let conv: ConvertResult;
      if (tab === 'audio') {
        conv = await convertAudioOffline(selectedFile.blob, selectedFile.name, {
          format: audioFormat,
          sampleRate,
          channels,
          onProgress: (pct, msg) => {
            setProgress(pct);
            setStatusText(msg);
          },
        });
      } else if (tab === 'image') {
        setProgress(35);
        setStatusText(`Convertendo para ${imageFormat.toUpperCase()}...`);
        conv = await convertImageOffline(
          selectedFile.blob,
          selectedFile.name,
          selectedFile.kind === 'video' ? 'video' : 'image',
          {
            format: imageFormat,
            quality: imageQuality,
            maxDimension,
            jpgBgColor,
            videoSeekSec,
          }
        );
        setProgress(100);
        setStatusText('Imagem convertida com sucesso!');
      } else {
        conv = await convertVideoOffline(
          selectedFile.blob,
          selectedFile.name,
          selectedFile.kind === 'image' ? 'image' : 'video',
          {
            format: videoFormat,
            maxHeight: videoMaxHeight,
            fps: videoFps,
            bitrateMbps: videoBitrateMbps,
            includeAudio: includeVideoAudio,
            imageDurationSec,
            onProgress: (pct, msg) => {
              setProgress(pct);
              setStatusText(msg);
            },
          }
        );
      }

      setResult(conv);
      setResultUrl(URL.createObjectURL(conv.blob));
      if (conv.note) setStatusText(conv.note);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Não foi possível converter este arquivo neste dispositivo.'
      );
      setStatusText(null);
    } finally {
      setConverting(false);
    }
  };

  const handleAddResultToLibrary = async () => {
    if (!result) return;
    const file = new File([result.blob], result.filename, { type: result.mimeType });
    const processed = await processImportedFile(file, result.filename, 'internal');
    if (processed) {
      await onImportMedia([processed]);
      setSavedFeedback('Adicionado à biblioteca!');
      window.setTimeout(() => setSavedFeedback(null), 2500);
    }
  };

  const handleSaveResultToGallery = async () => {
    if (!result) return;
    await onSaveToGallery({
      id: `gal-${Date.now()}`,
      name: result.filename,
      kind: tab,
      mimeType: result.mimeType,
      size: result.blob.size,
      width: result.width,
      height: result.height,
      duration: result.duration,
      blob: result.blob,
      thumbnailDataUrl: tab === 'image' && resultUrl ? resultUrl : selectedFile?.thumbnailDataUrl,
      createdAt: Date.now(),
    });
    setSavedFeedback('Salvo na Galeria!');
    window.setTimeout(() => setSavedFeedback(null), 2500);
  };

  const formatOptionsAudio: { id: AudioTargetFormat; label: string; desc: string }[] = [
    { id: 'wav', label: 'WAV', desc: 'PCM sem perdas' },
    { id: 'webm', label: 'WEBM', desc: 'Opus leve' },
    { id: 'ogg', label: 'OGG', desc: 'Opus comprimido' },
    { id: 'm4a', label: 'M4A', desc: 'AAC / MP4 áudio' },
  ];

  const formatOptionsImage: { id: ImageTargetFormat; label: string; desc: string }[] = [
    { id: 'png', label: 'PNG', desc: 'Com transparência' },
    { id: 'jpg', label: 'JPG', desc: 'Compacto p/ fotos' },
    { id: 'webp', label: 'WEBP', desc: 'Alta compressão' },
    { id: 'bmp', label: 'BMP', desc: 'Bitmap 24-bit' },
  ];

  const formatOptionsVideo: { id: VideoTargetFormat; label: string; desc: string }[] = [
    { id: 'mp4', label: 'MP4', desc: 'Compatível celular' },
    { id: 'webm', label: 'WEBM', desc: 'VP9 / VP8 + Opus' },
    { id: 'avi', label: 'AVI', desc: 'MJPEG + Áudio PCM' },
  ];

  return (
    <div className="max-w-6xl mx-auto pl-10 pr-2.5 sm:pl-11 sm:pr-5 py-3 pb-20 lg:pb-8 space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={`${ALL_ACCEPTED_EXTENSIONS},audio/*,video/*,image/*`}
        className="hidden"
        onChange={(e) => {
          void handleUploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Header & Category Switch */}
      <div className="rounded-xl bg-[#13161D] border border-white/8 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold text-white leading-tight">
              Conversor Universal Offline
            </h1>
            <p className="text-[10px] text-slate-400">
              Converta áudios, imagens e vídeos localmente no navegador sem enviar arquivos
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'audio' as const, label: 'Áudio', icon: Music },
            { id: 'image' as const, label: 'Imagem', icon: ImageIcon },
            { id: 'video' as const, label: 'Vídeo', icon: Film },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setResult(null);
                  setResultUrl(null);
                  setErrorText(null);
                  setStatusText(null);
                }}
                className={`h-7 px-2.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-[#1A1E28] text-slate-300 hover:bg-white/10 border border-white/8'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 px-2.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Importar
          </button>
        </div>
      </div>

      {/* Main Split: Source Files + Conversion Options & Output */}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-3 items-start">
        {/* Left: Source File Selector */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold text-slate-300">
              Arquivo de Origem ({compatibleFiles.length})
            </h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              + Do Dispositivo
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1">
            {compatibleFiles.length === 0 ? (
              <div className="py-6 px-2 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  Nenhum arquivo compatível importado para {tab === 'audio' ? 'Áudio' : tab === 'image' ? 'Imagem' : 'Vídeo'}.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 px-3 rounded-md bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  Selecionar Arquivo
                </button>
              </div>
            ) : (
              compatibleFiles.map((file) => {
                const isSelected = selectedFile?.id === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      setSelectedMediaId(file.id);
                      setResult(null);
                      setResultUrl(null);
                      setErrorText(null);
                    }}
                    className={`flex items-center gap-2 rounded-lg p-1.5 border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500/50 text-white'
                        : 'bg-[#1A1E28] border-white/5 text-slate-300 hover:border-white/15'
                    }`}
                  >
                    <div className="w-9 h-9 rounded bg-[#0B0D11] border border-white/10 shrink-0 flex items-center justify-center overflow-hidden">
                      {file.thumbnailDataUrl ? (
                        <img
                          src={file.thumbnailDataUrl}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : file.kind === 'audio' ? (
                        <Music className="w-4 h-4 text-cyan-400" />
                      ) : file.kind === 'video' ? (
                        <Film className="w-4 h-4 text-amber-400" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold truncate">{file.name}</p>
                      <p className="text-[10px] font-mono text-slate-400">
                        {file.extension.toUpperCase()} · {formatBytes(file.size)}
                        {file.duration ? ` · ${formatDuration(file.duration)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteMedia([file.id]);
                        if (selectedMediaId === file.id) setSelectedMediaId(null);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/15 cursor-pointer shrink-0"
                      title="Apagar arquivo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Format Options + Convert Button + Preview */}
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 space-y-3">
          {selectedFile ? (
            <div className="rounded-lg bg-[#1A1E28] border border-white/8 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-slate-400">Arquivo Selecionado</p>
                <p className="text-xs font-bold text-white truncate">{selectedFile.name}</p>
              </div>
              <span className="rounded bg-[#0B0D11] border border-white/10 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                {selectedFile.extension.toUpperCase()} · {formatBytes(selectedFile.size)}
              </span>
            </div>
          ) : (
            <div className="rounded-lg bg-[#1A1E28] border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-400">
              Importe ou selecione um arquivo à esquerda para configurar a conversão.
            </div>
          )}

          {/* Audio Converter Settings */}
          {tab === 'audio' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Formato de Saída (Áudio)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {formatOptionsAudio.map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setAudioFormat(fmt.id)}
                      className={`rounded-lg border p-2 text-left cursor-pointer transition-colors ${
                        audioFormat === fmt.id
                          ? 'border-amber-500 bg-amber-500/15 text-white'
                          : 'border-white/10 bg-[#1A1E28] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="text-xs font-bold block">{fmt.label}</span>
                      <span className="text-[10px] text-slate-400">{fmt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Taxa de Amostragem</label>
                  <select
                    value={sampleRate}
                    onChange={(e) => setSampleRate(Number(e.target.value) as 44100 | 48000)}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value={44100}>44.100 Hz (Padrão)</option>
                    <option value={48000}>48.000 Hz (Estúdio / Vídeo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Canais</label>
                  <select
                    value={channels}
                    onChange={(e) => setChannels(Number(e.target.value) as 1 | 2)}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value={2}>Estéreo (2 canais)</option>
                    <option value={1}>Mono (1 canal)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Image Converter Settings */}
          {tab === 'image' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Formato de Saída (Imagem)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {formatOptionsImage.map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setImageFormat(fmt.id)}
                      className={`rounded-lg border p-2 text-left cursor-pointer transition-colors ${
                        imageFormat === fmt.id
                          ? 'border-amber-500 bg-amber-500/15 text-white'
                          : 'border-white/10 bg-[#1A1E28] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="text-xs font-bold block">{fmt.label}</span>
                      <span className="text-[10px] text-slate-400">{fmt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Tamanho Máximo</label>
                  <select
                    value={maxDimension}
                    onChange={(e) => setMaxDimension(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value={0}>Tamanho Original</option>
                    <option value={1920}>Full HD (1920 px)</option>
                    <option value={1080}>1080 px</option>
                    <option value={720}>720 px</option>
                    <option value={512}>512 px (Ícone / Miniatura)</option>
                  </select>
                </div>

                {(imageFormat === 'jpg' || imageFormat === 'webp') && (
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Qualidade</span>
                      <span className="font-mono text-white">{Math.round(imageQuality * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={imageQuality}
                      onChange={(e) => setImageQuality(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}

                {(imageFormat === 'jpg' || imageFormat === 'bmp') && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Cor de Fundo (sem transparência)
                    </label>
                    <div className="flex items-center gap-1.5">
                      {[
                        { label: 'Preto', hex: '#000000' },
                        { label: 'Branco', hex: '#FFFFFF' },
                      ].map((bg) => (
                        <button
                          key={bg.hex}
                          type="button"
                          onClick={() => setJpgBgColor(bg.hex)}
                          className={`h-7 px-3 rounded border text-[11px] font-medium cursor-pointer ${
                            jpgBgColor === bg.hex
                              ? 'border-amber-500 bg-amber-500/20 text-white'
                              : 'border-white/12 bg-[#0B0D11] text-slate-300'
                          }`}
                        >
                          {bg.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedFile?.kind === 'video' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Capturar quadro do vídeo no segundo:
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={selectedFile.duration || 60}
                      step={0.2}
                      value={videoSeekSec}
                      onChange={(e) => setVideoSeekSec(Math.max(0, Number(e.target.value)))}
                      className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video Converter Settings */}
          {tab === 'video' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Formato de Saída (Vídeo)
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {formatOptionsVideo.map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setVideoFormat(fmt.id)}
                      className={`rounded-lg border p-2 text-left cursor-pointer transition-colors ${
                        videoFormat === fmt.id
                          ? 'border-amber-500 bg-amber-500/15 text-white'
                          : 'border-white/10 bg-[#1A1E28] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="text-xs font-bold block">{fmt.label}</span>
                      <span className="text-[10px] text-slate-400">{fmt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Resolução</label>
                  <select
                    value={videoMaxHeight}
                    onChange={(e) => setVideoMaxHeight(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white"
                  >
                    <option value={0}>Original</option>
                    <option value={1080}>1080p</option>
                    <option value={720}>720p (Leve)</option>
                    <option value={480}>480p (Rápido)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Taxa de Quadros</label>
                  <select
                    value={videoFps}
                    onChange={(e) => setVideoFps(Number(e.target.value) as 24 | 30)}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white"
                  >
                    <option value={24}>24 FPS</option>
                    <option value={30}>30 FPS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Qualidade</label>
                  <select
                    value={videoBitrateMbps}
                    onChange={(e) => setVideoBitrateMbps(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-1.5 text-xs text-white"
                  >
                    <option value={3}>3 Mbps (Compacto)</option>
                    <option value={6}>6 Mbps (Padrão)</option>
                    <option value={10}>10 Mbps (Alta)</option>
                  </select>
                </div>
              </div>

              {selectedFile?.kind === 'video' ? (
                <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeVideoAudio}
                    onChange={(e) => setIncludeVideoAudio(e.target.checked)}
                    className="accent-amber-500 w-4 h-4"
                  />
                  Manter trilha de áudio no vídeo convertido
                </label>
              ) : selectedFile?.kind === 'image' ? (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Duração do vídeo gerado da imagem (s)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={imageDurationSec}
                    onChange={(e) =>
                      setImageDurationSec(Math.max(1, Math.min(30, Number(e.target.value))))
                    }
                    className="w-32 rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              ) : null}
            </div>
          )}

          {/* Convert Button + Progress */}
          <div className="pt-1 space-y-2">
            <button
              type="button"
              disabled={!selectedFile || converting}
              onClick={() => void handleConvert()}
              className="w-full h-9 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-xs font-bold text-slate-950 inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${converting ? 'animate-spin' : ''}`} />
              {converting
                ? `Convertendo... ${progress}%`
                : `Converter ${tab === 'audio' ? 'Áudio' : tab === 'image' ? 'Imagem' : 'Vídeo'}`}
            </button>

            {(converting || statusText) && (
              <div className="space-y-1">
                {converting && (
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      style={{ width: `${progress}%` }}
                      className="h-full bg-amber-400 transition-all"
                    />
                  </div>
                )}
                {statusText && <p className="text-[11px] text-cyan-300">{statusText}</p>}
              </div>
            )}

            {errorText && (
              <p className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">
                {errorText}
              </p>
            )}
          </div>

          {/* Converted Output Preview & Actions */}
          {result && resultUrl && (
            <div className="rounded-xl bg-[#0B0D11] border border-emerald-500/35 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{result.filename}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-300">
                  {result.extension.toUpperCase()} · {formatBytes(result.blob.size)}
                  {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
                </span>
              </div>

              {tab === 'audio' && (
                <audio controls src={resultUrl} className="w-full h-9" />
              )}
              {tab === 'image' && (
                <div className="max-h-56 rounded-lg overflow-hidden bg-[#13161D] border border-white/10 flex items-center justify-center p-2">
                  <img
                    src={resultUrl}
                    alt={result.filename}
                    className="max-h-52 w-auto object-contain rounded"
                  />
                </div>
              )}
              {tab === 'video' &&
                (result.extension === 'avi' ? (
                  <div className="rounded-lg bg-[#13161D] border border-white/10 p-3 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Film className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white">
                        Vídeo AVI (MJPEG + PCM) pronto para baixar
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Navegadores web não reproduzem AVI diretamente na tela, mas o arquivo gerado abre normalmente no celular, VLC e reprodutores de vídeo.
                      </p>
                    </div>
                  </div>
                ) : (
                  <video
                    controls
                    src={resultUrl}
                    className="w-full max-h-60 rounded-lg bg-black border border-white/10"
                  />
                ))}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerBlobDownload(result.blob, result.filename)}
                  className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Arquivo
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddResultToLibrary()}
                  className="h-8 px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-semibold text-cyan-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Adicionar à Biblioteca
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveResultToGallery()}
                  className="h-8 px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 border border-white/12 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Images className="w-3.5 h-3.5 text-amber-400" />
                  Salvar na Galeria
                </button>
                {savedFeedback && (
                  <span className="text-[11px] font-semibold text-emerald-300">
                    {savedFeedback}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
