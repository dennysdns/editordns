import React, { useState } from 'react';
import { X } from 'lucide-react';
import { StudioView } from '../../types/studio';
import { STAGE_RESOLUTIONS } from '../../utils/resolutionPresets';

interface NewProjectModalProps {
  open: boolean;
  defaultFps: number;
  onClose: () => void;
  onCreate: (config: {
    name: string;
    width: number;
    height: number;
    fps: number;
    targetView: StudioView;
  }) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  open,
  defaultFps,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('Meu Projeto de Estúdio');
  const [resId, setResId] = useState<'9:16' | '16:9' | '1:1' | '4:5'>('9:16');
  const [fps, setFps] = useState(defaultFps || 24);
  const [targetView, setTargetView] = useState<StudioView>('animation');

  if (!open) return null;

  const selectedRes =
    STAGE_RESOLUTIONS.find((r) => r.id === resId) || STAGE_RESOLUTIONS[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      name: name.trim() || 'Projeto Sem Título',
      width: selectedRes.width,
      height: selectedRes.height,
      fps,
      targetView,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3">
      <div className="w-full max-w-md rounded-xl bg-[#13161D] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white">Novo Projeto Offline</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Nome do Projeto
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Animação Cena 01"
              className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
              Resolução e Proporção do Palco
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {STAGE_RESOLUTIONS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setResId(preset.id)}
                  className={`py-1.5 px-2 rounded-lg border text-center transition-colors cursor-pointer ${
                    resId === preset.id
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300 font-bold'
                      : 'border-white/10 bg-[#0B0D11] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="text-xs font-mono">{preset.label}</div>
                  <div className="text-[9px] text-slate-400 font-mono">
                    {preset.width}×{preset.height}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Taxa de Quadros (FPS)
              </label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
              >
                <option value={12}>12 FPS (Clássico)</option>
                <option value={24}>24 FPS (Cinema)</option>
                <option value={30}>30 FPS (Padrão)</option>
                <option value={60}>60 FPS (Fluido)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Abrir Ferramenta
              </label>
              <select
                value={targetView}
                onChange={(e) => setTargetView(e.target.value as StudioView)}
                className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="animation">Estúdio de Animação</option>
                <option value="video">Editor de Vídeo</option>
                <option value="audio">Editor de Áudio</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="h-7 px-3 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="h-7 px-3.5 rounded-lg bg-amber-500 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Criar Projeto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
