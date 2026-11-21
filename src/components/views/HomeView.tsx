import React from 'react';
import {
  Plus,
  FolderOpen,
  FileUp,
  Clapperboard,
  Film,
  Music,
  ScanEye,
  Eraser,
  Sparkles,
  Type,
  Images,
  BookmarkCheck,
  Download,
  Settings,
  Play,
  HardDrive,
  ArrowRightLeft,
} from 'lucide-react';
import { StudioProject, StudioView } from '../../types/studio';

interface HomeViewProps {
  projects: StudioProject[];
  activeProject: StudioProject | null;
  mediaCount: number;
  galleryCount: number;
  onNavigate: (view: StudioView) => void;
  onNewProject: () => void;
  onOpenProject: (project: StudioProject) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  projects,
  activeProject,
  mediaCount,
  galleryCount,
  onNavigate,
  onNewProject,
  onOpenProject,
}) => {
  const studioTools: {
    id: string;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    action: () => void;
    highlight?: boolean;
  }[] = [
    {
      id: 'new',
      label: 'NOVO PROJETO',
      subtitle: 'Criar cena do zero',
      icon: Plus,
      action: onNewProject,
      highlight: true,
    },
    {
      id: 'open',
      label: 'ABRIR PROJETO',
      subtitle: 'Retomar projeto salvo',
      icon: FolderOpen,
      action: () => onNavigate('projects'),
    },
    {
      id: 'import',
      label: 'IMPORTAR ARQUIVOS',
      subtitle: 'MP4, MP3, PNG, GIF e mais',
      icon: FileUp,
      action: () => onNavigate('files'),
    },
    {
      id: 'animation',
      label: 'ESTÚDIO DE ANIMAÇÃO',
      subtitle: 'Quadros, keyframes e traço',
      icon: Clapperboard,
      action: () => onNavigate('animation'),
    },
    {
      id: 'video',
      label: 'EDITOR DE VÍDEO',
      subtitle: 'Linha do tempo multipista',
      icon: Film,
      action: () => onNavigate('video'),
    },
    {
      id: 'audio',
      label: 'EDITOR DE ÁUDIO',
      subtitle: 'Ondas, equalizador e WAV',
      icon: Music,
      action: () => onNavigate('audio'),
    },
    {
      id: 'chroma',
      label: 'CHROMA KEY',
      subtitle: 'Tela verde e recorte de cor',
      icon: ScanEye,
      action: () => onNavigate('chroma'),
    },
    {
      id: 'bg-remover',
      label: 'REMOVER FUNDO',
      subtitle: 'Varinha mágica e pincel',
      icon: Eraser,
      action: () => onNavigate('bg-remover'),
    },
    {
      id: 'effects',
      label: 'EFEITOS ESPECIAIS',
      subtitle: 'Filtros, glitch e partículas',
      icon: Sparkles,
      action: () => onNavigate('effects'),
    },
    {
      id: 'text',
      label: 'TEXTO ANIMADO',
      subtitle: 'Tipografia cinética e títulos',
      icon: Type,
      action: () => onNavigate('text'),
    },
    {
      id: 'gallery',
      label: 'MINHA GALERIA',
      subtitle: `${galleryCount} criações salvas`,
      icon: Images,
      action: () => onNavigate('gallery'),
    },
    {
      id: 'projects',
      label: 'PROJETOS SALVOS',
      subtitle: `${projects.length} projetos locais`,
      icon: BookmarkCheck,
      action: () => onNavigate('projects'),
    },
    {
      id: 'converter',
      label: 'CONVERTER MÍDIA',
      subtitle: 'Áudio, imagem e vídeo',
      icon: ArrowRightLeft,
      action: () => onNavigate('converter'),
    },
    {
      id: 'export',
      label: 'EXPORTAR VÍDEO',
      subtitle: 'Renderizar MP4, WebM e PNG',
      icon: Download,
      action: () => onNavigate('export'),
    },
    {
      id: 'settings',
      label: 'CONFIGURAÇÕES',
      subtitle: 'FPS, resolução e memória',
      icon: Settings,
      action: () => onNavigate('settings'),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-4 pb-20 lg:pb-8 space-y-4">
      {/* Hero / Active Studio Summary */}
      <section className="rounded-xl bg-[#13161D] border border-white/8 p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <p className="text-[11px] font-medium text-amber-400 tracking-wide">
            Processamento 100% Local · Modo Offline Ativo
          </p>
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight text-balance">
            Super Animator Studio Android
          </h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            Animações por quadros e keyframes, editor de vídeo multipista, áudio, chroma key e efeitos offline no seu dispositivo.
          </p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5 text-[11px] text-slate-400 font-mono tabular-nums">
            <span className="inline-flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-cyan-400" />
              {mediaCount} arquivos
            </span>
            <span aria-hidden="true">·</span>
            <span>{projects.length} projetos</span>
            <span aria-hidden="true">·</span>
            <span>{galleryCount} na galeria</span>
          </div>
        </div>

        {activeProject && (
          <div className="flex items-center gap-3 rounded-xl bg-[#1A1E28] border border-white/10 p-2.5 sm:min-w-[290px]">
            <div className="w-16 h-12 rounded-lg overflow-hidden bg-[#0B0D11] border border-white/10 shrink-0 flex items-center justify-center">
              {activeProject.thumbnailDataUrl ? (
                <img
                  src={activeProject.thumbnailDataUrl}
                  alt={activeProject.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Clapperboard className="w-5 h-5 text-slate-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-slate-400">Projeto Ativo</p>
              <p className="text-xs font-semibold text-white truncate">{activeProject.name}</p>
              <p className="text-[10px] text-slate-400 font-mono tabular-nums">
                {activeProject.width}×{activeProject.height} · {activeProject.fps} FPS
              </p>
            </div>
            <button
              onClick={() => onNavigate(activeProject.lastTool || 'animation')}
              className="h-7 px-2.5 rounded-md bg-amber-500 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              Continuar
            </button>
          </div>
        )}
      </section>

      {/* Main 14 Studio Action Buttons Grid (Compact) */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs sm:text-sm font-semibold text-white">Ferramentas do Estúdio</h2>
          <span className="text-[11px] text-slate-400">Todas as ferramentas liberadas localmente</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2">
          {studioTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={tool.action}
                className={`group min-h-[64px] rounded-lg border p-2.5 text-left flex flex-col justify-between transition-colors cursor-pointer ${
                  tool.highlight
                    ? 'bg-amber-500 border-amber-400 text-slate-950 hover:bg-amber-400'
                    : 'bg-[#13161D] border-white/8 text-white hover:bg-[#1A1E28] hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon
                    className={`w-4 h-4 ${
                      tool.highlight ? 'text-slate-950' : 'text-amber-400 group-hover:text-amber-300'
                    }`}
                  />
                </div>
                <div className="mt-1.5">
                  <div className="text-[11px] font-bold tracking-tight leading-tight">
                    {tool.label}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 truncate ${
                      tool.highlight ? 'text-slate-900/80' : 'text-slate-400'
                    }`}
                  >
                    {tool.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent Projects Thumbnails */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs sm:text-sm font-semibold text-white">Projetos Recentes</h2>
          <button
            onClick={() => onNavigate('projects')}
            className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            Ver todos os projetos
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/12 bg-[#13161D] p-6 text-center">
            <p className="text-xs text-slate-300">Nenhum projeto salvo ainda.</p>
            <button
              onClick={onNewProject}
              className="mt-2.5 h-7 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Criar Primeiro Projeto
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {projects.slice(0, 8).map((proj) => (
              <div
                key={proj.id}
                onClick={() => onOpenProject(proj)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenProject(proj);
                }}
                className="group rounded-lg bg-[#13161D] border border-white/8 overflow-hidden hover:border-amber-500/60 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-500 flex items-center gap-2 p-1.5"
              >
                <div className="w-12 h-11 rounded bg-[#0B0D11] relative overflow-hidden flex items-center justify-center shrink-0 border border-white/8">
                  {proj.thumbnailDataUrl ? (
                    <img
                      src={proj.thumbnailDataUrl}
                      alt={proj.name}
                      className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-200"
                    />
                  ) : (
                    <Clapperboard className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-semibold text-white truncate leading-tight">
                    {proj.name}
                  </h3>
                  <p className="text-[9px] text-slate-400 mt-0.5 font-mono tabular-nums truncate">
                    {proj.width}×{proj.height} · {proj.frames.length}Q
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
