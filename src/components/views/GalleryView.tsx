import React, { useEffect, useState } from 'react';
import { Download, Trash2, Images, Film, Music, Image as ImageIcon, Eye, X } from 'lucide-react';
import { GalleryItem } from '../../types/studio';
import { formatBytes, formatDuration } from '../../utils/mediaImporter';
import { triggerBlobDownload } from '../../utils/videoExporter';

interface GalleryViewProps {
  items: GalleryItem[];
  onDeleteItem: (id: string) => Promise<void>;
}

export const GalleryView: React.FC<GalleryViewProps> = ({ items, onDeleteItem }) => {
  const [filter, setFilter] = useState<'all' | 'video' | 'image' | 'audio'>('all');
  const [activeItem, setActiveItem] = useState<GalleryItem | null>(null);
  const [activeUrl, setActiveUrl] = useState<string>('');

  useEffect(() => {
    if (!activeItem) {
      setActiveUrl('');
      return;
    }
    const url = URL.createObjectURL(activeItem.blob);
    setActiveUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activeItem]);

  const filtered = items.filter((item) => (filter === 'all' ? true : item.kind === filter));

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-3 pb-20 lg:pb-6 space-y-3">
      <div className="rounded-xl bg-[#13161D] border border-white/8 p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-bold text-white">Minha Galeria Local</h1>
          <p className="text-[11px] text-slate-400">
            Vídeos, animações, imagens PNG e mixagens WAV exportados no dispositivo
          </p>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0D11]">
          {[
            { id: 'all', label: 'Tudo' },
            { id: 'video', label: 'Vídeos' },
            { id: 'image', label: 'Imagens' },
            { id: 'audio', label: 'Áudios' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                filter === tab.id ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/12 bg-[#13161D] p-8 text-center space-y-1.5">
          <Images className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-xs text-slate-300">Nenhuma exportação encontrada nesta categoria.</p>
          <p className="text-[11px] text-slate-400">
            Exporte um vídeo, imagem PNG ou mixagem WAV para visualizá-lo aqui offline.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-[#13161D] border border-white/8 overflow-hidden flex flex-col"
            >
              <div
                onClick={() => setActiveItem(item)}
                className="aspect-video bg-[#0B0D11] flex items-center justify-center relative cursor-pointer group"
              >
                {item.thumbnailDataUrl ? (
                  <img
                    src={item.thumbnailDataUrl}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                  />
                ) : item.kind === 'video' ? (
                  <Film className="w-7 h-7 text-amber-400" />
                ) : item.kind === 'audio' ? (
                  <Music className="w-7 h-7 text-cyan-400" />
                ) : (
                  <ImageIcon className="w-7 h-7 text-slate-400" />
                )}
              </div>

              <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                <div>
                  <h3 className="text-[11px] font-semibold text-white truncate">{item.name}</h3>
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                    {formatBytes(item.size)}
                    {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/8">
                  <button
                    onClick={() => setActiveItem(item)}
                    className="h-7 px-2 rounded-lg bg-[#1A1E28] hover:bg-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3 h-3 text-cyan-400" />
                    Abrir
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => triggerBlobDownload(item.blob, item.name)}
                      className="h-7 w-7 rounded-lg text-amber-400 hover:bg-white/5 inline-flex items-center justify-center cursor-pointer"
                      title="Baixar no dispositivo"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteItem(item.id)}
                      className="h-7 w-7 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5 inline-flex items-center justify-center cursor-pointer"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3">
          <div className="w-full max-w-2xl rounded-xl bg-[#13161D] border border-white/10 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
              <h3 className="text-xs font-semibold text-white truncate">{activeItem.name}</h3>
              <button
                onClick={() => setActiveItem(null)}
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-white inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-[#0B0D11] flex items-center justify-center min-h-[220px]">
              {activeItem.kind === 'image' && activeUrl && (
                <img src={activeUrl} alt={activeItem.name} className="max-h-[400px] object-contain rounded-lg" />
              )}
              {activeItem.kind === 'video' && activeUrl && (
                <video src={activeUrl} controls autoPlay className="max-h-[400px] w-full rounded-lg" />
              )}
              {activeItem.kind === 'audio' && activeUrl && (
                <audio src={activeUrl} controls className="w-full max-w-md" />
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-white/10 flex justify-end">
              <button
                onClick={() => triggerBlobDownload(activeItem.blob, activeItem.name)}
                className="h-7 px-3 rounded-lg bg-amber-500 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Salvar no Celular
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
