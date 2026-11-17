import {
  CustomFolder,
  DEFAULT_CHROMA_KEY,
  DEFAULT_EFFECTS,
  DEFAULT_SETTINGS,
  GalleryItem,
  MediaFile,
  StudioProject,
  StudioSettings,
} from '../types/studio';

const DB_NAME = 'SuperAnimatorStudioDB';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'media';
const STORE_GALLERY = 'gallery';
const STORE_FOLDERS = 'customFolders';

const SETTINGS_KEY = 'super_animator_settings_v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_GALLERY)) {
        db.createObjectStore(STORE_GALLERY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function putIntoStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function resizeProjectDimensions(
  project: StudioProject,
  newWidth: number,
  newHeight: number
): StudioProject {
  if (project.width === newWidth && project.height === newHeight) return project;
  const rx = newWidth / Math.max(1, project.width);
  const ry = newHeight / Math.max(1, project.height);
  return {
    ...project,
    width: newWidth,
    height: newHeight,
    updatedAt: Date.now(),
    layers: project.layers.map((layer) => ({
      ...layer,
      keyframes: layer.keyframes.map((kf) => ({
        ...kf,
        x: Math.round(kf.x * rx),
        y: Math.round(kf.y * ry),
      })),
    })),
    frames: project.frames.map((frame) => ({
      ...frame,
      strokes: frame.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((pt) => ({
          x: pt.x * rx,
          y: pt.y * ry,
        })),
      })),
    })),
  };
}

export function createStarterProject(
  name = 'Cena Piloto — Estúdio 2D',
  width = 1080,
  height = 1920,
  fps = 24
): StudioProject {
  const now = Date.now();
  const frameCount = 12;
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    id: `frame-${now}-${i}`,
    label: `Q${i + 1}`,
    durationMs: Math.round(1000 / fps),
    backgroundColor: '#111521',
    strokes: [],
  }));

  return {
    id: `proj-${now}`,
    name,
    width,
    height,
    fps,
    lastTool: 'animation',
    createdAt: now,
    updatedAt: now,
    particles: 'none',
    frames,
    layers: [
      {
        id: `layer-astro-${now}`,
        name: 'Astronauta Principal',
        kind: 'character',
        characterId: 'astronauta',
        visible: true,
        locked: false,
        fillColor: '#E2E8F0',
        strokeColor: '#0F172A',
        accentColor: '#F59E0B',
        width: 190,
        height: 220,
        motionPreset: 'float',
        motionIntensity: 18,
        effects: { ...DEFAULT_EFFECTS },
        chromaKey: { ...DEFAULT_CHROMA_KEY },
        keyframes: [
          {
            frameIndex: 0,
            x: Math.round(width * 0.28),
            y: Math.round(height * 0.52),
            scaleX: 1,
            scaleY: 1,
            rotation: -6,
            opacity: 1,
            easing: 'ease-in-out',
          },
          {
            frameIndex: 6,
            x: Math.round(width * 0.52),
            y: Math.round(height * 0.44),
            scaleX: 1.08,
            scaleY: 1.08,
            rotation: 4,
            opacity: 1,
            easing: 'ease-in-out',
          },
          {
            frameIndex: 11,
            x: Math.round(width * 0.72),
            y: Math.round(height * 0.5),
            scaleX: 1,
            scaleY: 1,
            rotation: -2,
            opacity: 1,
            easing: 'ease-out',
          },
        ],
      },
      {
        id: `layer-rocket-${now}`,
        name: 'Foguete de Cena',
        kind: 'character',
        characterId: 'foguete',
        visible: true,
        locked: false,
        fillColor: '#F8FAFC',
        strokeColor: '#1E293B',
        accentColor: '#06B6D4',
        width: 140,
        height: 180,
        motionPreset: 'none',
        motionIntensity: 15,
        effects: { ...DEFAULT_EFFECTS },
        chromaKey: { ...DEFAULT_CHROMA_KEY },
        keyframes: [
          {
            frameIndex: 0,
            x: Math.round(width * 0.76),
            y: Math.round(height * 0.65),
            scaleX: 0.9,
            scaleY: 0.9,
            rotation: -25,
            opacity: 1,
            easing: 'ease-out',
          },
          {
            frameIndex: 11,
            x: Math.round(width * 0.8),
            y: Math.round(height * 0.34),
            scaleX: 1.05,
            scaleY: 1.05,
            rotation: -18,
            opacity: 1,
            easing: 'ease-out',
          },
        ],
      },
      {
        id: `layer-title-${now}`,
        name: 'Título de Abertura',
        kind: 'text',
        visible: true,
        locked: false,
        fillColor: '#F59E0B',
        strokeColor: '#0B0D11',
        accentColor: '#06B6D4',
        width: 520,
        height: 90,
        motionPreset: 'none',
        motionIntensity: 10,
        textConfig: {
          text: 'SUPER ANIMATOR',
          fontFamily: 'Plus Jakarta Sans',
          fontSize: 48,
          fontWeight: '800',
          color: '#F8FAFC',
          strokeColor: '#0B0D11',
          strokeWidth: 4,
          shadowBlur: 12,
          shadowColor: 'rgba(245, 158, 11, 0.45)',
          backgroundColor: 'transparent',
          backgroundPadding: 12,
          animation: 'slide-up',
          align: 'center',
        },
        effects: { ...DEFAULT_EFFECTS },
        chromaKey: { ...DEFAULT_CHROMA_KEY },
        keyframes: [
          {
            frameIndex: 0,
            x: Math.round(width * 0.5),
            y: Math.round(height * 0.84),
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            opacity: 1,
            easing: 'ease-out',
          },
        ],
      },
    ],
    videoClips: [],
    audioClips: [],
  };
}

export function createBlankProject(
  name: string,
  _width = 1080,
  _height = 1920,
  fps = 24,
  lastTool: StudioProject['lastTool'] = 'animation'
): StudioProject {
  const now = Date.now();
  return {
    id: `proj-${now}`,
    name: name.trim() || 'Novo Projeto',
    width: 1080,
    height: 1920,
    fps,
    lastTool,
    createdAt: now,
    updatedAt: now,
    particles: 'none',
    frames: Array.from({ length: 8 }, (_, i) => ({
      id: `frame-${now}-${i}`,
      label: `Q${i + 1}`,
      durationMs: Math.round(1000 / fps),
      backgroundColor: '#111521',
      strokes: [],
    })),
    layers: [],
    videoClips: [],
    audioClips: [],
  };
}

export const localDb = {
  async listProjects(): Promise<StudioProject[]> {
    const projects = await getAllFromStore<StudioProject>(STORE_PROJECTS);
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async saveProject(project: StudioProject): Promise<void> {
    await putIntoStore(STORE_PROJECTS, {
      ...project,
      updatedAt: Date.now(),
    });
  },

  async deleteProject(id: string): Promise<void> {
    await deleteFromStore(STORE_PROJECTS, id);
  },

  async listMedia(): Promise<MediaFile[]> {
    const items = await getAllFromStore<MediaFile>(STORE_MEDIA);
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },

  async saveMedia(file: MediaFile): Promise<void> {
    await putIntoStore(STORE_MEDIA, file);
  },

  async deleteMedia(id: string): Promise<void> {
    await deleteFromStore(STORE_MEDIA, id);
  },

  async listGallery(): Promise<GalleryItem[]> {
    const items = await getAllFromStore<GalleryItem>(STORE_GALLERY);
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },

  async saveGalleryItem(item: GalleryItem): Promise<void> {
    await putIntoStore(STORE_GALLERY, item);
  },

  async deleteGalleryItem(id: string): Promise<void> {
    await deleteFromStore(STORE_GALLERY, id);
  },

  async listCustomFolders(): Promise<CustomFolder[]> {
    const folders = await getAllFromStore<CustomFolder>(STORE_FOLDERS);
    return folders.sort((a, b) => a.createdAt - b.createdAt);
  },

  async saveCustomFolder(folder: CustomFolder): Promise<void> {
    await putIntoStore(STORE_FOLDERS, folder);
  },

  async deleteCustomFolder(id: string): Promise<void> {
    await deleteFromStore(STORE_FOLDERS, id);
  },

  getSettings(): StudioSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), defaultWidth: 1080, defaultHeight: 1920 };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: StudioSettings): void {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...settings, defaultWidth: 1080, defaultHeight: 1920 })
    );
  },

  async clearAllData(): Promise<void> {
    await Promise.all([
      clearStore(STORE_PROJECTS),
      clearStore(STORE_MEDIA),
      clearStore(STORE_GALLERY),
      clearStore(STORE_FOLDERS),
    ]);
    localStorage.removeItem(SETTINGS_KEY);
  },
};
