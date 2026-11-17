import React, { useEffect, useState } from 'react';
import { HardDrive, Trash2, CheckCircle2, Settings } from 'lucide-react';
import { StudioSettings } from '../../types/studio';
import { formatBytes } from '../../utils/mediaImporter';
import { PWAInstallButton } from '../PWAInstallButton';

interface SettingsViewProps {
  settings: StudioSettings;
  onSaveSettings: (next: StudioSettings) => void;
  onClearAllStorage: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onClearAllStorage,
}) => {
  const [quotaInfo, setQuotaInfo] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      void navigator.storage.estimate().then((est) => {
        setQuotaInfo({ usage: est.usage || 0, quota: est.quota || 0 });
      });
    }
  }, []);

  const update = (patch: Partial<StudioSettings>) => {
    onSaveSettings({ ...settings, ...patch });
    setSavedToast(true);
    window.setTimeout(() => setSavedToast(false), 1800);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10 space-y-6">
      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-amber-400" />
            <div>
              <h1 className="text-lg font-bold text-white">Configurações do Estúdio</h1>
              <p className="text-xs text-slate-400">
                Preferências locais de animação, áudio, grade e armazenamento offline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {savedToast && (
              <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvo
              </span>
            )}
            <PWAInstallButton />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Resolução Única do Estúdio</label>
            <div className="w-full rounded-xl bg-[#0B0D11] border border-amber-500/30 px-3 py-2.5 text-sm text-amber-300 font-mono">
              Vertical 1080×1920 (9:16 — Tamanho Único)
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">FPS Padrão</label>
            <select
              value={settings.defaultFps}
              onChange={(e) => update({ defaultFps: Number(e.target.value) })}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white font-mono"
            >
              <option value={12}>12 FPS</option>
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1.5">
              <span>Opacidade Papel Cebola</span>
              <span className="font-mono">{Math.round(settings.onionSkinOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={0.6}
              step={0.05}
              value={settings.onionSkinOpacity}
              onChange={(e) => update({ onionSkinOpacity: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Taxa de Amostragem de Áudio</label>
            <select
              value={settings.audioSampleRate}
              onChange={(e) => update({ audioSampleRate: Number(e.target.value) as 44100 | 48000 })}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-3 py-2.5 text-sm text-white font-mono"
            >
              <option value={44100}>44.100 Hz (CD / Música)</option>
              <option value={48000}>48.000 Hz (Vídeo Profissional)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-5 pt-2">
          <label className="inline-flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.gridVisible}
              onChange={(e) => update({ gridVisible: e.target.checked })}
              className="accent-amber-500 w-4 h-4"
            />
            Exibir grade no Estúdio de Animação
          </label>
          <label className="inline-flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.snapToGrid}
              onChange={(e) => update({ snapToGrid: e.target.checked })}
              className="accent-amber-500 w-4 h-4"
            />
            Alinhar objetos à grade ao arrastar
          </label>
        </div>

        {/* Local Storage Section */}
        <div className="pt-5 border-t border-white/8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white inline-flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              Armazenamento Offline Local (IndexedDB)
            </span>
            {quotaInfo && (
              <span className="text-xs font-mono text-slate-400">
                Usado: {formatBytes(quotaInfo.usage)} / {formatBytes(quotaInfo.quota)}
              </span>
            )}
          </div>

          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-xs font-semibold text-red-300 hover:bg-red-500/25 inline-flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Limpar Todos os Projetos e Mídias Locais
            </button>
          ) : (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-red-200">
                Tem certeza? Isso apagará todos os arquivos importados, projetos e galeria deste dispositivo.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    await onClearAllStorage();
                    setConfirmClear(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-500 text-xs font-bold text-white cursor-pointer"
                >
                  Confirmar Limpeza
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
