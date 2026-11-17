import React, { useEffect, useRef, useState } from 'react';
import { Type, Clapperboard, Film, Play, RotateCcw } from 'lucide-react';
import {
  AnimationLayer,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  StudioProject,
  TextAnimationPreset,
  TextLayerConfig,
  VideoClip,
} from '../../types/studio';
import { drawTextLayer } from '../../utils/canvasRenderer';

interface AnimatedTextViewProps {
  project: StudioProject;
  onUpdateProject: (updated: StudioProject) => void;
  onGoToStudio: (view: 'animation' | 'video') => void;
}

const ANIMATION_PRESETS: { id: TextAnimationPreset; label: string }[] = [
  { id: 'typewriter', label: 'Máquina de Escrever' },
  { id: 'slide-up', label: 'Deslizar para Cima' },
  { id: 'bounce', label: 'Quicar Elástico' },
  { id: 'pulse', label: 'Pulsar' },
  { id: 'wave', label: 'Onda Suave' },
  { id: 'zoom-in', label: 'Zoom de Entrada' },
  { id: 'spin', label: 'Girar 360°' },
  { id: 'none', label: 'Estático' },
];

export const AnimatedTextView: React.FC<AnimatedTextViewProps> = ({
  project,
  onUpdateProject,
  onGoToStudio,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [config, setConfig] = useState<TextLayerConfig>({
    text: 'SUPER ANIMATOR STUDIO',
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 52,
    fontWeight: '800',
    color: '#F8FAFC',
    strokeColor: '#0B0D11',
    strokeWidth: 4,
    shadowBlur: 14,
    shadowColor: 'rgba(245, 158, 11, 0.55)',
    backgroundColor: 'transparent',
    backgroundPadding: 14,
    animation: 'typewriter',
    align: 'center',
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setProgress((p) => (p >= 1 ? 0 : Number((p + 0.03).toFixed(3))));
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 900;
    canvas.height = 420;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0B0D11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    drawTextLayer(ctx, config, progress);
    ctx.restore();
  }, [config, progress]);

  const addToAnimationStudio = () => {
    const layer: AnimationLayer = {
      id: `layer-txt-${Date.now()}`,
      name: config.text.slice(0, 20) || 'Texto Animado',
      kind: 'text',
      visible: true,
      locked: false,
      fillColor: config.color,
      strokeColor: config.strokeColor,
      accentColor: '#F59E0B',
      width: 540,
      height: 110,
      motionPreset: 'none',
      motionIntensity: 14,
      textConfig: { ...config },
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
      keyframes: [
        {
          frameIndex: 0,
          x: Math.round(project.width / 2),
          y: Math.round(project.height / 2),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          easing: 'ease-out',
        },
      ],
    };
    onUpdateProject({
      ...project,
      layers: [...project.layers, layer],
    });
    setNotice('Texto animado adicionado ao Estúdio de Animação!');
  };

  const addToVideoEditor = () => {
    const clip: VideoClip = {
      id: `vclip-txt-${Date.now()}`,
      track: 'overlay',
      name: config.text.slice(0, 20) || 'Texto Animado',
      kind: 'text',
      startTime: 0,
      duration: 4,
      trimStart: 0,
      speed: 1,
      volume: 1,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      transition: 'fade-both',
      textConfig: { ...config },
      effects: { ...DEFAULT_EFFECTS },
      chromaKey: { ...DEFAULT_CHROMA_KEY },
    };
    onUpdateProject({
      ...project,
      videoClips: [...project.videoClips, clip],
    });
    setNotice('Texto animado adicionado ao Editor de Vídeo!');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8 space-y-5">
      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Editor de Texto Animado e Títulos</h1>
          <p className="text-xs text-slate-400">
            Crie títulos cinéticos offline com contorno, sombra e animações prontas para cena
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={addToAnimationStudio}
            className="min-h-[40px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Clapperboard className="w-4 h-4" />
            Adicionar à Animação
          </button>
          <button
            onClick={addToVideoEditor}
            className="min-h-[40px] px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Film className="w-4 h-4" />
            Adicionar ao Vídeo
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <div className="flex gap-2">
            <button
              onClick={() => onGoToStudio('animation')}
              className="underline font-semibold cursor-pointer"
            >
              Abrir Animação
            </button>
            <button
              onClick={() => onGoToStudio('video')}
              className="underline font-semibold cursor-pointer"
            >
              Abrir Vídeo
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="min-h-[38px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-amber-400" />
              {playing ? 'Pausar Prévia' : 'Reproduzir Prévia'}
            </button>
            <button
              onClick={() => setProgress(0)}
              className="min-h-[38px] px-3 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-xs text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reiniciar
            </button>
          </div>

          <div className="rounded-xl bg-[#0B0D11] border border-white/10 overflow-hidden">
            <canvas ref={canvasRef} className="w-full max-h-[420px] object-contain" />
          </div>
        </div>

        <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3.5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 pb-2 border-b border-white/8">
            <Type className="w-4 h-4 text-amber-400" />
            Propriedades do Texto
          </h3>

          <div>
            <label className="block text-xs text-slate-300 mb-1">Texto</label>
            <input
              type="text"
              value={config.text}
              onChange={(e) => setConfig({ ...config, text: e.target.value })}
              className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">Animação</label>
            <select
              value={config.animation}
              onChange={(e) =>
                setConfig({ ...config, animation: e.target.value as TextAnimationPreset })
              }
              className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white"
            >
              {ANIMATION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Fonte</label>
              <select
                value={config.fontFamily}
                onChange={(e) => setConfig({ ...config, fontFamily: e.target.value })}
                className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2 py-2 text-xs text-white"
              >
                <option value="Plus Jakarta Sans">Sans Moderna</option>
                <option value="Georgia">Editorial Serif</option>
                <option value="JetBrains Mono">Monospace</option>
                <option value="Impact">Impacto</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Tamanho (px)</label>
              <input
                type="number"
                min={16}
                max={140}
                value={config.fontSize}
                onChange={(e) => setConfig({ ...config, fontSize: Number(e.target.value) })}
                className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-2 text-xs text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Cor do Texto</label>
              <input
                type="color"
                value={config.color}
                onChange={(e) => setConfig({ ...config, color: e.target.value })}
                className="w-full h-9 rounded bg-transparent cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Cor do Contorno</label>
              <input
                type="color"
                value={config.strokeColor}
                onChange={(e) => setConfig({ ...config, strokeColor: e.target.value })}
                className="w-full h-9 rounded bg-transparent cursor-pointer"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Espessura do Contorno</span>
              <span className="font-mono">{config.strokeWidth}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              value={config.strokeWidth}
              onChange={(e) => setConfig({ ...config, strokeWidth: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
