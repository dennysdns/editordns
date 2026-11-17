import React, { useRef, useState, useEffect } from 'react';
import {
  Folder,
  HardDrive,
  Smartphone,
  Download,
  Music,
  Video,
  Image as ImageIcon,
  FileText,
  FolderPlus,
  FileUp,
  Files,
  CheckSquare,
  Eye,
  PlusCircle,
  Trash2,
  Edit3,
  Save,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  CustomFolder,
  MediaFile,
  StudioProject,
  VirtualFolderId,
} from '../../types/studio';
import {
  ALL_ACCEPTED_EXTENSIONS,
  formatBytes,
  formatDuration,
  processImportedFile,
} from '../../utils/mediaImporter';

interface FileManagerViewProps {
  mediaFiles: MediaFile[];
  customFolders: CustomFolder[];
  activeProject: StudioProject | null;
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onDeleteMedia: (ids: string[]) => Promise<void>;
  onCreateCustomFolder: (name: string) => Promise<CustomFolder>;
  onAddMediaToProject: (files: MediaFile[]) => void;
  onRenameProject: (newName: string) => Promise<void>;
  onSaveProject: () => Promise<void>;
}

const ANDROID_FOLDERS: {
  id: VirtualFolderId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'internal', label: 'Memória Interna', icon: Smartphone },
  { id: 'sdcard', label: 'Cartão SD', icon: HardDrive },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'music', label: 'Música', icon: Music },
  { id: 'videos', label: 'Vídeos', icon: Video },
  { id: 'images', label: 'Imagens', icon: ImageIcon },
  { id: 'documents', label: 'Documentos', icon: FileText },
];

export const FileManagerView: React.FC<FileManagerViewProps> = ({
  mediaFiles,
  customFolders,
  activeProject,
  onImportMedia,
  onDeleteMedia,
  onCreateCustomFolder,
  onAddMediaToProject,
  onRenameProject,
  onSaveProject,
}) => {
  const singleInputRef = useRef<HTMLInputElement>(null);
  const multiInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const [currentFolder, setCurrentFolder] = useState<VirtualFolderId>('internal');
  const [selectedCustomFolderId, setSelectedCustomFolderId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState(activeProject?.name || '');

  useEffect(() => {
    setRenameValue(activeProject?.name || '');
  }, [activeProject]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(previewFile.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  const visibleFiles = mediaFiles.filter((f) => {
    if (currentFolder === 'internal') return true;
    if (currentFolder === 'custom') {
      return f.folder === 'custom' && f.customFolderId === selectedCustomFolderId;
    }
    return f.folder === currentFolder;
  });

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    setStatusMessage(`Processando ${fileList.length} arquivo(s) localmente...`);
    const imported: MediaFile[] = [];
    let ignored = 0;

    for (const file of Array.from(fileList)) {
      const processed = await processImportedFile(
        file,
        file.name,
        currentFolder,
        selectedCustomFolderId
      );
      if (processed) imported.push(processed);
      else ignored++;
    }

    if (imported.length > 0) {
      await onImportMedia(imported);
    }

    setImporting(false);
    setStatusMessage(
      `${imported.length} arquivo(s) importado(s) com sucesso.${
        ignored > 0 ? ` ${ignored} formato(s) não suportado(s) ignorado(s).` : ''
      }`
    );
  };

  const handleNativeSAFDirectory = async () => {
    const win = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await win.showDirectoryPicker();
        setImporting(true);
        const imported: MediaFile[] = [];
        const entries = (dirHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
        for await (const entry of entries) {
          if (entry.kind === 'file') {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            const processed = await processImportedFile(
              file,
              file.name,
              currentFolder,
              selectedCustomFolderId
            );
            if (processed) imported.push(processed);
          }
        }
        if (imported.length > 0) await onImportMedia(imported);
        setImporting(false);
        setStatusMessage(`${imported.length} arquivo(s) carregado(s) da pasta via SAF.`);
        return;
      } catch {
        setImporting(false);
        return;
      }
    }
    dirInputRef.current?.click();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === visibleFiles.length && visibleFiles.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleFiles.map((f) => f.id)));
    }
  };

  const selectedFiles = visibleFiles.filter((f) => selectedIds.has(f.id));

  const handleAddSelectedToProject = () => {
    const targets = selectedFiles.length > 0 ? selectedFiles : visibleFiles.slice(0, 1);
    if (targets.length === 0) {
      setStatusMessage('Selecione ou importe ao menos um arquivo para adicionar ao projeto.');
      return;
    }
    onAddMediaToProject(targets);
    setStatusMessage(`${targets.length} arquivo(s) adicionado(s) ao projeto "${activeProject?.name || 'Atual'}".`);
  };

  const handleRemoveSelected = async () => {
    if (selectedFiles.length === 0) {
      setStatusMessage('Selecione um ou mais arquivos para remover.');
      return;
    }
    await onDeleteMedia(selectedFiles.map((f) => f.id));
    setSelectedIds(new Set());
    setStatusMessage(`${selectedFiles.length} arquivo(s) removido(s) do armazenamento local.`);
  };

  const handlePreviewSelected = () => {
    const target = selectedFiles[0] || visibleFiles[0];
    if (!target) {
      setStatusMessage('Nenhum arquivo disponível para visualizar.');
      return;
    }
    setPreviewFile(target);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const created = await onCreateCustomFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolder(false);
    setCurrentFolder('custom');
    setSelectedCustomFolderId(created.id);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-10 space-y-5">
      {/* Hidden Native File Inputs (Android SAF & Desktop File Pickers) */}
      <input
        ref={singleInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={multiInputRef}
        type="file"
        multiple
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={dirInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in Chromium/Android browsers
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Toolbar */}
      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Gerenciador de Arquivos do Dispositivo</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Storage Access Framework (SAF) · Suporte a MP3, WAV, AAC, OGG, M4A, MP4, MOV, MKV, AVI, JPG, PNG, WEBP e GIF
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => singleInputRef.current?.click()}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileUp className="w-4 h-4" />
              IMPORTAR ARQUIVO
            </button>
            <button
              onClick={() => multiInputRef.current?.click()}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-white hover:bg-white/10 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Files className="w-4 h-4 text-amber-400" />
              IMPORTAR VÁRIOS ARQUIVOS
            </button>
            <button
              onClick={handleNativeSAFDirectory}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Folder className="w-4 h-4 text-cyan-400" />
              ACESSAR PASTA DO CELULAR
            </button>
          </div>
        </div>

        {/* Required Command Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/8">
          <button
            onClick={handleSelectAll}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
            SELECIONAR TUDO
          </button>
          <button
            onClick={handlePreviewSelected}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            VISUALIZAR ARQUIVO
          </button>
          <button
            onClick={handleAddSelectedToProject}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            ADICIONAR AO PROJETO
          </button>
          <button
            onClick={handleRemoveSelected}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-xs font-medium text-slate-200 hover:text-red-300 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            REMOVER ARQUIVO
          </button>
          <button
            onClick={() => setShowRenameModal(true)}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5 text-amber-400" />
            RENOMEAR PROJETO
          </button>
          <button
            onClick={async () => {
              await onSaveProject();
              setStatusMessage(`Projeto "${activeProject?.name || 'Atual'}" salvo localmente com sucesso.`);
            }}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            SALVAR PROJETO
          </button>
        </div>

        {statusMessage && (
          <div className="rounded-lg bg-[#0B0D11] border border-white/10 px-3.5 py-2 text-xs text-slate-200 flex items-center justify-between gap-2">
            <span>{importing ? 'Importando... ' : ''}{statusMessage}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
              aria-label="Fechar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Split: Android Folders Sidebar + Files Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
        <aside className="rounded-2xl bg-[#13161D] border border-white/8 p-3 space-y-1">
          <div className="px-2.5 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Diretórios do Dispositivo</span>
            <button
              onClick={() => setShowNewFolder((v) => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-white/5 cursor-pointer"
              title="Nova pasta personalizada"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {showNewFolder && (
            <form onSubmit={handleCreateFolder} className="p-2 flex gap-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Nome da pasta..."
                className="flex-1 min-w-0 rounded-lg bg-[#0B0D11] border border-white/12 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-xs font-semibold text-slate-950 cursor-pointer"
              >
                OK
              </button>
            </form>
          )}

          {ANDROID_FOLDERS.map((folder) => {
            const Icon = folder.icon;
            const active = currentFolder === folder.id;
            const count =
              folder.id === 'internal'
                ? mediaFiles.length
                : mediaFiles.filter((f) => f.folder === folder.id).length;
            return (
              <button
                key={folder.id}
                onClick={() => {
                  setCurrentFolder(folder.id);
                  setSelectedCustomFolderId(undefined);
                  setSelectedIds(new Set());
                }}
                className={`w-full min-h-[42px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'text-slate-300 hover:bg-white/5 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{folder.label}</span>
                </span>
                <span className="font-mono tabular-nums text-[11px] text-slate-400">{count}</span>
              </button>
            );
          })}

          {customFolders.length > 0 && (
            <div className="pt-2 mt-2 border-t border-white/8 space-y-1">
              <p className="px-2.5 py-1 text-[11px] font-medium text-slate-400">
                Pastas Personalizadas
              </p>
              {customFolders.map((cf) => {
                const active = currentFolder === 'custom' && selectedCustomFolderId === cf.id;
                const count = mediaFiles.filter(
                  (f) => f.folder === 'custom' && f.customFolderId === cf.id
                ).length;
                return (
                  <button
                    key={cf.id}
                    onClick={() => {
                      setCurrentFolder('custom');
                      setSelectedCustomFolderId(cf.id);
                      setSelectedIds(new Set());
                    }}
                    className={`w-full min-h-[42px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'text-slate-300 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Folder className="w-4 h-4 shrink-0 text-cyan-400" />
                      <span className="truncate">{cf.name}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Files Content Grid */}
        <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 min-h-[420px]">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/8">
            <span className="text-sm font-semibold text-white">
              {currentFolder === 'custom'
                ? customFolders.find((c) => c.id === selectedCustomFolderId)?.name || 'Pasta Personalizada'
                : ANDROID_FOLDERS.find((f) => f.id === currentFolder)?.label}
            </span>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {visibleFiles.length} item(ns) · {selectedIds.size} selecionado(s)
            </span>
          </div>

          {visibleFiles.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <FileUp className="w-10 h-10 text-slate-500 mx-auto" />
              <p className="text-sm text-slate-300">Nenhum arquivo nesta pasta ainda.</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Importe músicas MP3/WAV, vídeos MP4/MOV/MKV ou imagens PNG/JPG/GIF diretamente do armazenamento do celular sem precisar copiar para pastas específicas.
              </p>
              <button
                onClick={() => multiInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                <Files className="w-4 h-4" />
                Selecionar Arquivos do Dispositivo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleFiles.map((file) => {
                const isSelected = selectedIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => toggleSelect(file.id)}
                    className={`rounded-xl border p-3 flex items-center gap-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-white/8 bg-[#1A1E28] hover:border-white/20'
                    }`}
                  >
                    <div className="w-16 h-16 rounded-lg bg-[#0B0D11] border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {file.thumbnailDataUrl ? (
                        <img
                          src={file.thumbnailDataUrl}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : file.kind === 'audio' ? (
                        <Music className="w-6 h-6 text-cyan-400" />
                      ) : file.kind === 'video' ? (
                        <Video className="w-6 h-6 text-amber-400" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{file.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                        {file.extension.toUpperCase()} · {formatBytes(file.size)}
                        {file.duration ? ` · ${formatDuration(file.duration)}` : ''}
                      </p>
                      {!file.supported && (
                        <p className="text-[11px] text-amber-400 flex items-center gap-1 mt-1 truncate">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Codec limitado
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewFile(file);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-white/5 cursor-pointer"
                        title="Visualizar arquivo"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddMediaToProject([file]);
                          setStatusMessage(`"${file.name}" adicionado ao projeto atual.`);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-white/5 cursor-pointer"
                        title="Adicionar ao projeto"
                      >
                        <PlusCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview Lightbox Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#13161D] border border-white/10 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{previewFile.name}</h3>
                <p className="text-xs text-slate-400 font-mono tabular-nums">
                  {previewFile.extension.toUpperCase()} · {formatBytes(previewFile.size)}
                  {previewFile.width && previewFile.height ? ` · ${previewFile.width}×${previewFile.height}` : ''}
                </p>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 bg-[#0B0D11] flex items-center justify-center min-h-[260px]">
              {previewFile.kind === 'image' && previewUrl && (
                <img src={previewUrl} alt={previewFile.name} className="max-h-[420px] rounded-lg object-contain" />
              )}
              {previewFile.kind === 'video' && previewUrl && (
                <video src={previewUrl} controls className="max-h-[420px] w-full rounded-lg" />
              )}
              {previewFile.kind === 'audio' && previewUrl && (
                <div className="w-full max-w-md space-y-4 text-center py-6">
                  <Music className="w-12 h-12 text-cyan-400 mx-auto" />
                  <audio src={previewUrl} controls className="w-full" />
                </div>
              )}
            </div>

            {previewFile.supportNote && (
              <div className="px-5 py-2.5 bg-amber-500/10 border-t border-amber-500/20 text-xs text-amber-300">
                {previewFile.supportNote}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-white/10">
              <button
                onClick={() => {
                  onAddMediaToProject([previewFile]);
                  setStatusMessage(`"${previewFile.name}" adicionado ao projeto.`);
                  setPreviewFile(null);
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Adicionar ao Projeto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Project Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#13161D] border border-white/10 p-6 space-y-4">
            <h3 className="text-base font-semibold text-white">Renomear Projeto Atual</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full rounded-xl bg-[#0B0D11] border border-white/12 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  await onRenameProject(renameValue.trim() || 'Projeto Sem Título');
                  setShowRenameModal(false);
                  setStatusMessage('Projeto renomeado e salvo localmente.');
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Salvar Nome
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
