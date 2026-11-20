import React, { useEffect, useState } from 'react';
import { HardDrive, Trash2, CheckCircle2, Settings, Monitor } from 'lucide-react';
import { StudioSettings } from '../../types/studio';
import { formatBytes } from '../../utils/mediaImporter';
import { STAGE_RESOLUTIONS } from '../../utils/resolutionPresets';
import { PWAInstallButton } from '../PWAInstallButton';

interface SettingsViewProps {
  settings: StudioSettings;
  onSaveSettings: (next: StudioSettings) => void;
  onClearAllStorage: () => Promise<void>;
  onOpenDesktopModal: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onClearAllStorage,
  onOpenDesktopModal,
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
    <div className="max-w-4xl mx-auto px-3 sm:px-5 py-4 pb-20 lg:pb-8 space-y-4">
      <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-amber-400" />
            <div>
              <h1 className="text-sm sm:text-base font-bold text-white">Configurações do Estúdio</h1>
              <p className="text-[11px] text-slate-400">
                Preferências locais de animação, resolução, áudio e armazenamento offline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {savedToast && (
              <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvo
              </span>
            )}
            <button
              type="button"
              onClick={onOpenDesktopModal}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Monitor className="w-4 h-4" />
              Android (.apk) / Desktop (.exe / .dmg)
            </button>
            <PWAInstallButton />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] text-slate-300 mb-1">Resolução Padrão de Novos Projetos</label>
            <div className="grid grid-cols-4 gap-1.5">
              {STAGE_RESOLUTIONS.map((preset) => {
                const active =
                  settings.defaultWidth === preset.width &&
                  settings.defaultHeight === preset.height;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      update({ defaultWidth: preset.width, defaultHeight: preset.height })
                    }
                    className={`h-8 rounded-lg text-[11px] font-mono font-semibold border cursor-pointer ${
                      active
                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                        : 'bg-[#0B0D11] border-white/12 text-slate-300 hover:bg-white/5'
                    }`}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] font-mono text-slate-400 mt-1">
              Selecionado: {settings.defaultWidth}×{settings.defaultHeight} px
            </p>
          </div>

          <div>
            <label className="block text-[11px] text-slate-300 mb-1">FPS Padrão</label>
            <select
              value={settings.defaultFps}
              onChange={(e) => update({ defaultFps: Number(e.target.value) })}
              className="w-full h-8 rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 text-xs text-white font-mono"
            >
              <option value={12}>12 FPS</option>
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-slate-300 mb-1">
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
            <label className="block text-[11px] text-slate-300 mb-1">Taxa de Amostragem de Áudio</label>
            <select
              value={settings.audioSampleRate}
              onChange={(e) => update({ audioSampleRate: Number(e.target.value) as 44100 | 48000 })}
              className="w-full h-8 rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 text-xs text-white font-mono"
            >
              <option value={44100}>44.100 Hz (CD / Música)</option>
              <option value={48000}>48.000 Hz (Vídeo Profissional)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.gridVisible}
              onChange={(e) => update({ gridVisible: e.target.checked })}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            Exibir grade no Estúdio de Animação
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.snapToGrid}
              onChange={(e) => update({ snapToGrid: e.target.checked })}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            Alinhar objetos à grade ao arrastar
          </label>
        </div>

        {/* Local Storage Section */}
        <div className="pt-4 border-t border-white/8 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              Armazenamento Offline Local (IndexedDB)
            </span>
            {quotaInfo && (
              <span className="text-[11px] font-mono text-slate-400">
                Usado: {formatBytes(quotaInfo.usage)} / {formatBytes(quotaInfo.quota)}
              </span>
            )}
          </div>

          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="h-7 px-3 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar Todos os Projetos e Mídias Locais
            </button>
          ) : (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-red-200">
                Tem certeza? Isso apagará todos os arquivos importados, projetos e galeria deste dispositivo.
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setConfirmClear(false)}
                  className="h-7 px-2.5 rounded-md bg-white/10 text-[11px] text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    await onClearAllStorage();
                    setConfirmClear(false);
                  }}
                  className="h-7 px-2.5 rounded-md bg-red-500 text-[11px] font-bold text-white cursor-pointer"
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
