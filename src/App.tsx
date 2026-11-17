import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  FolderOpen,
  Clapperboard,
  Film,
  Download,
  ArrowLeft,
} from 'lucide-react';
import {
  CustomFolder,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  GalleryItem,
  MediaFile,
  StudioProject,
  StudioSettings,
  StudioView,
} from './types/studio';
import {
  createBlankProject,
  createStarterProject,
  localDb,
  resizeProjectDimensions,
} from './storage/localDb';
import {
  ensureStudioBackgroundLoaded,
  generateProjectThumbnail,
} from './utils/canvasRenderer';
import { HomeView } from './components/views/HomeView';
import { NewProjectModal } from './components/views/NewProjectModal';
import { FileManagerView } from './components/views/FileManagerView';
import { AnimationStudioView } from './components/views/AnimationStudioView';
import { VideoEditorView } from './components/views/VideoEditorView';
import { AudioEditorView } from './components/views/AudioEditorView';
import { ChromaKeyView } from './components/views/ChromaKeyView';
import { BgRemoverView } from './components/views/BgRemoverView';
import { SpecialEffectsView } from './components/views/SpecialEffectsView';
import { AnimatedTextView } from './components/views/AnimatedTextView';
import { GalleryView } from './components/views/GalleryView';
import { SavedProjectsView } from './components/views/SavedProjectsView';
import { ExportView } from './components/views/ExportView';
import { SettingsView } from './components/views/SettingsView';
import { decodeAudioBlob } from './utils/audioEngine';
import { DecodedGif, decodeAnimatedGifBlob } from './utils/gifDecoder';

export default function App() {
  const [view, setView] = useState<StudioView>('home');
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(null);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [settings, setSettings] = useState<StudioSettings>(() => localDb.getSettings());
  const [showNewModal, setShowNewModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const gifCacheRef = useRef<Map<string, DecodedGif>>(new Map());
  const videoCacheRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [, setCacheVersion] = useState(0);

  // Hydrate offline IndexedDB on startup
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        let [projs, media, folders, gallery] = await Promise.all([
          localDb.listProjects(),
          localDb.listMedia(),
          localDb.listCustomFolders(),
          localDb.listGallery(),
        ]);

        await ensureStudioBackgroundLoaded();

        if (projs.length === 0) {
          const starter = createStarterProject();
          starter.thumbnailDataUrl = generateProjectThumbnail(starter, imageCacheRef.current);
          await localDb.saveProject(starter);
          projs = [starter];
        } else {
          const migrated: StudioProject[] = [];
          for (const p of projs) {
            const normalized =
              p.width !== 1080 || p.height !== 1920
                ? resizeProjectDimensions(p, 1080, 1920)
                : p;
            const thumb = generateProjectThumbnail(normalized, imageCacheRef.current);
            const updatedProj = {
              ...normalized,
              thumbnailDataUrl: thumb || normalized.thumbnailDataUrl,
            };
            if (p.width !== 1080 || p.height !== 1920 || thumb) {
              await localDb.saveProject(updatedProj);
            }
            migrated.push(updatedProj);
          }
          projs = migrated;
        }

        if (!mounted) return;
        setProjects(projs);
        setActiveProject(projs[0]);
        setMediaFiles(media);
        setCustomFolders(folders);
        setGalleryItems(gallery);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Preload HTMLImageElements, animated GIF frames, and HTMLVideoElements for all imported media
  useEffect(() => {
    const imgCache = imageCacheRef.current;
    const gCache = gifCacheRef.current;
    const vCache = videoCacheRef.current;

    mediaFiles.forEach((mf) => {
      if (mf.kind === 'image') {
        if (!imgCache.has(mf.id)) {
          const url = URL.createObjectURL(mf.blob);
          const img = new Image();
          img.onload = () => {
            imgCache.set(mf.id, img);
            setCacheVersion((v) => v + 1);
          };
          img.src = url;
        }
        if (
          (mf.extension === 'gif' || mf.mimeType === 'image/gif' || mf.extension === 'webp') &&
          !gCache.has(mf.id)
        ) {
          void decodeAnimatedGifBlob(mf.blob, mf.mimeType).then((decoded) => {
            if (decoded) {
              gCache.set(mf.id, decoded);
              setCacheVersion((v) => v + 1);
            }
          });
        }
      } else if (mf.kind === 'video' && !vCache.has(mf.id)) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(mf.blob);
        video.playsInline = true;
        video.preload = 'auto';
        video.loop = true;
        video.onloadeddata = () => {
          setCacheVersion((v) => v + 1);
        };
        vCache.set(mf.id, video);
      }
    });
  }, [mediaFiles]);

  // Auto-save active project periodically
  useEffect(() => {
    if (!activeProject) return;
    const intervalMs = Math.max(5, settings.autoSaveIntervalSec) * 1000;
    const id = window.setInterval(() => {
      void persistProject(activeProject);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [activeProject, settings.autoSaveIntervalSec]);

  const persistProject = async (proj: StudioProject) => {
    const thumb = generateProjectThumbnail(proj, imageCacheRef.current);
    const updated: StudioProject = {
      ...proj,
      thumbnailDataUrl: thumb || proj.thumbnailDataUrl,
      updatedAt: Date.now(),
    };
    await localDb.saveProject(updated);
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      const list = exists
        ? prev.map((p) => (p.id === updated.id ? updated : p))
        : [updated, ...prev];
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const handleUpdateProject = (updated: StudioProject) => {
    setActiveProject(updated);
  };

  const handleSaveCurrentProject = async () => {
    if (!activeProject) return;
    await persistProject(activeProject);
  };

  const handleCreateProject = async (config: {
    name: string;
    width: number;
    height: number;
    fps: number;
    targetView: StudioView;
  }) => {
    const created = createBlankProject(
      config.name,
      1080,
      1920,
      config.fps,
      config.targetView
    );
    await ensureStudioBackgroundLoaded();
    created.thumbnailDataUrl = generateProjectThumbnail(created, imageCacheRef.current);
    await localDb.saveProject(created);
    setProjects((prev) => [created, ...prev]);
    setActiveProject(created);
    setShowNewModal(false);
    setView(config.targetView);
  };

  const handleOpenProject = (proj: StudioProject) => {
    setActiveProject(proj);
    setView(proj.lastTool || 'animation');
  };

  const handleDuplicateProject = async (proj: StudioProject) => {
    const now = Date.now();
    const copy: StudioProject = {
      ...proj,
      id: `proj-${now}`,
      name: `${proj.name} (Cópia)`,
      createdAt: now,
      updatedAt: now,
    };
    await localDb.saveProject(copy);
    setProjects((prev) => [copy, ...prev]);
  };

  const handleRenameProjectById = async (id: string, name: string) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    const updated = { ...target, name, updatedAt: Date.now() };
    await localDb.saveProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (activeProject?.id === id) setActiveProject(updated);
  };

  const handleDeleteProject = async (id: string) => {
    await localDb.deleteProject(id);
    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    if (activeProject?.id === id) {
      setActiveProject(remaining[0] || null);
    }
  };

  const handleImportMedia = async (files: MediaFile[]) => {
    for (const f of files) {
      await localDb.saveMedia(f);
    }
    setMediaFiles((prev) => [...files, ...prev]);
  };

  const handleDeleteMedia = async (ids: string[]) => {
    for (const id of ids) {
      await localDb.deleteMedia(id);
      imageCacheRef.current.delete(id);
      gifCacheRef.current.delete(id);
      const v = videoCacheRef.current.get(id);
      if (v) {
        URL.revokeObjectURL(v.src);
        videoCacheRef.current.delete(id);
      }
    }
    setMediaFiles((prev) => prev.filter((m) => !ids.includes(m.id)));
  };

  const handleCreateCustomFolder = async (name: string) => {
    const folder: CustomFolder = {
      id: `folder-${Date.now()}`,
      name,
      createdAt: Date.now(),
    };
    await localDb.saveCustomFolder(folder);
    setCustomFolders((prev) => [...prev, folder]);
    return folder;
  };

  const handleAddMediaToProject = async (files: MediaFile[]) => {
    if (!activeProject) return;
    let next = { ...activeProject };

    for (const mf of files) {
      if (mf.kind === 'image') {
        const aspect = mf.width && mf.height ? mf.width / mf.height : 1;
        const h = 240;
        const w = Math.round(h * aspect);
        next.layers = [
          ...next.layers,
          {
            id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name: mf.name,
            kind: 'image',
            mediaId: mf.id,
            visible: true,
            locked: false,
            fillColor: '#FFFFFF',
            strokeColor: '#000000',
            accentColor: '#F59E0B',
            width: Math.min(next.width * 0.7, Math.max(80, w)),
            height: Math.min(next.height * 0.7, h),
            motionPreset: 'none',
            motionIntensity: 14,
            effects: { ...DEFAULT_EFFECTS },
            chromaKey: { ...DEFAULT_CHROMA_KEY },
            keyframes: [
              {
                frameIndex: 0,
                x: Math.round(next.width / 2),
                y: Math.round(next.height / 2),
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                opacity: 1,
                easing: 'ease-in-out',
              },
            ],
          },
        ];
      } else if (mf.kind === 'video') {
        const aspect = mf.width && mf.height ? mf.width / mf.height : 9 / 16;
        const h = 420;
        const w = Math.round(h * aspect);
        next.layers = [
          ...next.layers,
          {
            id: `layer-vid-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name: mf.name,
            kind: 'video',
            mediaId: mf.id,
            visible: true,
            locked: false,
            fillColor: '#FFFFFF',
            strokeColor: '#000000',
            accentColor: '#F59E0B',
            width: Math.min(next.width * 0.85, Math.max(120, w)),
            height: Math.min(next.height * 0.85, h),
            motionPreset: 'none',
            motionIntensity: 14,
            effects: { ...DEFAULT_EFFECTS },
            chromaKey: { ...DEFAULT_CHROMA_KEY },
            keyframes: [
              {
                frameIndex: 0,
                x: Math.round(next.width / 2),
                y: Math.round(next.height / 2),
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                opacity: 1,
                easing: 'ease-in-out',
              },
            ],
          },
        ];
        const end = next.videoClips.reduce(
          (m, c) => Math.max(m, c.startTime + c.duration / Math.max(0.25, c.speed)),
          0
        );
        next.videoClips = [
          ...next.videoClips,
          {
            id: `vclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            track: 'video',
            mediaId: mf.id,
            name: mf.name,
            kind: 'video',
            startTime: end,
            duration: mf.duration || 5,
            trimStart: 0,
            speed: 1,
            volume: 1,
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
            transition: 'none',
            effects: { ...DEFAULT_EFFECTS },
            chromaKey: { ...DEFAULT_CHROMA_KEY },
          },
        ];
      } else if (mf.kind === 'audio') {
        let peaks = Array.from({ length: 64 }, () => 0.35);
        let dur = mf.duration || 5;
        try {
          const decoded = await decodeAudioBlob(mf.blob);
          peaks = decoded.peaks;
          dur = decoded.duration;
        } catch {
          // fallback
        }
        next.audioClips = [
          ...next.audioClips,
          {
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
          },
        ];
      }
    }

    setActiveProject(next);
    await persistProject(next);
  };

  const handleSaveToGallery = async (item: GalleryItem) => {
    await localDb.saveGalleryItem(item);
    setGalleryItems((prev) => [item, ...prev]);
  };

  const handleDeleteGalleryItem = async (id: string) => {
    await localDb.deleteGalleryItem(id);
    setGalleryItems((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSaveSettings = (next: StudioSettings) => {
    localDb.saveSettings(next);
    setSettings(next);
  };

  const handleClearAllStorage = async () => {
    await localDb.clearAllData();
    imageCacheRef.current.clear();
    const fresh = createStarterProject();
    await localDb.saveProject(fresh);
    setProjects([fresh]);
    setActiveProject(fresh);
    setMediaFiles([]);
    setCustomFolders([]);
    setGalleryItems([]);
    setView('home');
  };

  const navigate = (nextView: StudioView) => {
    if (activeProject && ['animation', 'video', 'audio'].includes(nextView)) {
      const updated = { ...activeProject, lastTool: nextView };
      setActiveProject(updated);
    }
    setView(nextView);
  };

  const currentProject = activeProject || createStarterProject();

  return (
    <div className="min-h-screen bg-[#0B0D11] text-[#F1F5F9] flex flex-col">
      {/* Top Bar Contract: [Brand title] — [4-5 nav links] — [1 primary CTA] */}
      <header className="sticky top-0 z-40 h-14 bg-[#0B0D11]/95 backdrop-blur-md border-b border-white/8 px-4 sm:px-6 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 min-w-0">
          {view !== 'home' && (
            <button
              onClick={() => navigate('home')}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors lg:hidden cursor-pointer"
              aria-label="Voltar ao Início"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => navigate('home')}
            className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Super Animator Studio
          </button>
        </div>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-300">
          {[
            { id: 'home', label: 'Início' },
            { id: 'files', label: 'Arquivos' },
            { id: 'animation', label: 'Animação' },
            { id: 'video', label: 'Vídeo' },
            { id: 'audio', label: 'Áudio' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id as StudioView)}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 cursor-pointer ${
                view === item.id
                  ? 'text-white border-amber-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="shrink-0">
          {view === 'home' ? (
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Novo Projeto
            </button>
          ) : (
            <button
              onClick={() => navigate('export')}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Exportar Vídeo
            </button>
          )}
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1">
        {loading ? (
          <div className="max-w-7xl mx-auto px-6 py-16 text-center text-sm text-slate-400">
            Carregando armazenamento local do estúdio...
          </div>
        ) : (
          <>
            {view === 'home' && (
              <HomeView
                projects={projects}
                activeProject={activeProject}
                mediaCount={mediaFiles.length}
                galleryCount={galleryItems.length}
                onNavigate={navigate}
                onNewProject={() => setShowNewModal(true)}
                onOpenProject={handleOpenProject}
              />
            )}

            {view === 'files' && (
              <FileManagerView
                mediaFiles={mediaFiles}
                customFolders={customFolders}
                activeProject={activeProject}
                onImportMedia={handleImportMedia}
                onDeleteMedia={handleDeleteMedia}
                onCreateCustomFolder={handleCreateCustomFolder}
                onAddMediaToProject={handleAddMediaToProject}
                onRenameProject={async (newName) => {
                  if (activeProject) await handleRenameProjectById(activeProject.id, newName);
                }}
                onSaveProject={handleSaveCurrentProject}
              />
            )}

            {view === 'animation' && (
              <AnimationStudioView
                project={currentProject}
                mediaFiles={mediaFiles}
                imageCache={imageCacheRef.current}
                gifCache={gifCacheRef.current}
                videoCache={videoCacheRef.current}
                settings={settings}
                onUpdateProject={handleUpdateProject}
                onSaveProject={handleSaveCurrentProject}
                onImportMedia={handleImportMedia}
              />
            )}

            {view === 'video' && (
              <VideoEditorView
                project={currentProject}
                mediaFiles={mediaFiles}
                imageCache={imageCacheRef.current}
                gifCache={gifCacheRef.current}
                videoCache={videoCacheRef.current}
                onUpdateProject={handleUpdateProject}
                onSaveProject={handleSaveCurrentProject}
                onImportMedia={handleImportMedia}
                onOpenExport={() => navigate('export')}
              />
            )}

            {view === 'audio' && (
              <AudioEditorView
                project={currentProject}
                mediaFiles={mediaFiles}
                onUpdateProject={handleUpdateProject}
                onImportMedia={handleImportMedia}
                onSaveToGallery={handleSaveToGallery}
              />
            )}

            {view === 'chroma' && (
              <ChromaKeyView
                mediaFiles={mediaFiles}
                onImportMedia={handleImportMedia}
                onSaveToGallery={handleSaveToGallery}
              />
            )}

            {view === 'bg-remover' && (
              <BgRemoverView
                mediaFiles={mediaFiles}
                onImportMedia={handleImportMedia}
                onSaveToGallery={handleSaveToGallery}
              />
            )}

            {view === 'effects' && (
              <SpecialEffectsView
                project={currentProject}
                mediaFiles={mediaFiles}
                imageCache={imageCacheRef.current}
                onUpdateProject={handleUpdateProject}
                onSaveToGallery={handleSaveToGallery}
              />
            )}

            {view === 'text' && (
              <AnimatedTextView
                project={currentProject}
                onUpdateProject={handleUpdateProject}
                onGoToStudio={(v) => navigate(v)}
              />
            )}

            {view === 'gallery' && (
              <GalleryView
                items={galleryItems}
                onDeleteItem={handleDeleteGalleryItem}
              />
            )}

            {view === 'projects' && (
              <SavedProjectsView
                projects={projects}
                activeProjectId={activeProject?.id || null}
                onOpenProject={handleOpenProject}
                onNewProject={() => setShowNewModal(true)}
                onDuplicateProject={handleDuplicateProject}
                onRenameProjectById={handleRenameProjectById}
                onDeleteProject={handleDeleteProject}
              />
            )}

            {view === 'export' && (
              <ExportView
                project={currentProject}
                mediaFiles={mediaFiles}
                imageCache={imageCacheRef.current}
                gifCache={gifCacheRef.current}
                onSaveToGallery={handleSaveToGallery}
              />
            )}

            {view === 'settings' && (
              <SettingsView
                settings={settings}
                onSaveSettings={handleSaveSettings}
                onClearAllStorage={handleClearAllStorage}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Android Thumb-Zone Bottom Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#0B0D11]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center">
        {[
          { id: 'home', label: 'Início', icon: Home },
          { id: 'files', label: 'Arquivos', icon: FolderOpen },
          { id: 'animation', label: 'Animação', icon: Clapperboard },
          { id: 'video', label: 'Vídeo', icon: Film },
          { id: 'export', label: 'Exportar', icon: Download },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id as StudioView)}
              className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                active ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <NewProjectModal
        open={showNewModal}
        defaultFps={settings.defaultFps}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateProject}
      />
    </div>
  );
}
