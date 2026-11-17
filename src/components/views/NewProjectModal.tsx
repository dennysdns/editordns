import React, { useState } from 'react';
import { X, Smartphone } from 'lucide-react';
import { StudioView } from '../../types/studio';

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

const FIXED_RESOLUTION = {
  label: '9:16 Vertical — Resolução Única (1080×1920)',
  width: 1080,
  height: 1920,
};

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  open,
  defaultFps,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('Meu Projeto de Estúdio');
  const [fps, setFps] = useState(defaultFps || 24);
  const [targetView, setTargetView] = useState<StudioView>('animation');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      name: name.trim() || 'Projeto Sem Título',
      width: FIXED_RESOLUTION.width,
      height: FIXED_RESOLUTION.height,
      fps,
      targetView,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#13161D] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Novo Projeto Offline</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Nome do Projeto
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Animação Cena 01"
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Resolução e Proporção (Tamanho Único)
            </label>
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-white">
              <Smartphone className="w-4 h-4 shrink-0 text-amber-400" />
              <span className="text-xs font-semibold">{FIXED_RESOLUTION.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Taxa de Quadros (FPS)
              </label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
              >
                <option value={12}>12 FPS (Clássico)</option>
                <option value={24}>24 FPS (Cinema)</option>
                <option value={30}>30 FPS (Padrão)</option>
                <option value={60}>60 FPS (Fluido)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Abrir Ferramenta
              </label>
              <select
                value={targetView}
                onChange={(e) => setTargetView(e.target.value as StudioView)}
                className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="animation">Estúdio de Animação</option>
                <option value="video">Editor de Vídeo</option>
                <option value="audio">Editor de Áudio</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-amber-500 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Criar Projeto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
