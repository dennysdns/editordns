import React, { useState } from 'react';
import { Clapperboard, Copy, Edit3, Play, Plus, Trash2 } from 'lucide-react';
import { StudioProject } from '../../types/studio';

interface SavedProjectsViewProps {
  projects: StudioProject[];
  activeProjectId: string | null;
  onOpenProject: (project: StudioProject) => void;
  onNewProject: () => void;
  onDuplicateProject: (project: StudioProject) => Promise<void>;
  onRenameProjectById: (id: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
}

export const SavedProjectsView: React.FC<SavedProjectsViewProps> = ({
  projects,
  activeProjectId,
  onOpenProject,
  onNewProject,
  onDuplicateProject,
  onRenameProjectById,
  onDeleteProject,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-3 pb-20 lg:pb-6 space-y-3">
      <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-bold text-white">Projetos Salvos no Dispositivo</h1>
          <p className="text-[11px] text-slate-400">
            Todos os projetos ficam armazenados offline no IndexedDB local
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="h-7 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo Projeto
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/12 bg-[#13161D] p-8 text-center">
          <p className="text-xs text-slate-300">Nenhum projeto salvo localmente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((proj) => {
            const isCurrent = proj.id === activeProjectId;
            return (
              <div
                key={proj.id}
                className={`rounded-xl bg-[#13161D] border overflow-hidden flex flex-col ${
                  isCurrent ? 'border-amber-500/60' : 'border-white/8'
                }`}
              >
                <div
                  onClick={() => onOpenProject(proj)}
                  className="aspect-video bg-[#0B0D11] relative flex items-center justify-center cursor-pointer group"
                >
                  {proj.thumbnailDataUrl ? (
                    <img
                      src={proj.thumbnailDataUrl}
                      alt={proj.name}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                    />
                  ) : (
                    <Clapperboard className="w-8 h-8 text-slate-600" />
                  )}
                </div>

                <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                  {editingId === proj.id ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await onRenameProjectById(proj.id, editName.trim() || proj.name);
                        setEditingId(null);
                      }}
                      className="flex gap-1.5"
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 h-7 rounded-lg bg-[#0B0D11] border border-white/15 px-2 text-[11px] text-white focus:outline-none focus:border-amber-500"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="h-7 px-2.5 rounded-lg bg-amber-500 text-[11px] font-semibold text-slate-950 cursor-pointer"
                      >
                        OK
                      </button>
                    </form>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-white truncate">{proj.name}</h3>
                        {isCurrent && (
                          <span className="text-[10px] font-medium text-amber-400 shrink-0">
                            Ativo
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                        {proj.width}×{proj.height} · {proj.fps} FPS · {proj.frames.length} quadros
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Atualizado em {new Date(proj.updatedAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-white/8">
                    <button
                      onClick={() => onOpenProject(proj)}
                      className="h-7 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      Continuar Edição
                    </button>

                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => {
                          setEditingId(proj.id);
                          setEditName(proj.name);
                        }}
                        className="h-7 w-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 inline-flex items-center justify-center cursor-pointer"
                        title="Renomear"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDuplicateProject(proj)}
                        className="h-7 w-7 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-white/5 inline-flex items-center justify-center cursor-pointer"
                        title="Duplicar"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteProject(proj.id)}
                        className="h-7 w-7 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5 inline-flex items-center justify-center cursor-pointer"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
