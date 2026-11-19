import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  GripVertical,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  getMasterVolumeState,
  setMasterVolumeState,
  subscribeMasterVolume,
} from '../utils/audioEngine';

export const LeftWallVolume: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [volState, setVolState] = useState(() => getMasterVolumeState());
  const [offsetY, setOffsetY] = useState(0);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startY: number;
    origY: number;
  }>({
    active: false,
    moved: false,
    startY: 0,
    origY: 0,
  });

  useEffect(() => {
    return subscribeMasterVolume(setVolState);
  }, []);

  const clampOffsetY = (ny: number) => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const maxDown = Math.max(80, vh - 260);
    return Math.max(-44, Math.min(maxDown, ny));
  };

  useEffect(() => {
    const onResize = () => setOffsetY((prev) => clampOffsetY(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleWallDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      active: true,
      moved: false,
      startY: e.clientY,
      origY: offsetY,
    };
  };

  const handleWallDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.active) return;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.abs(dy) > 5) {
      dragRef.current.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore if pointer released
      }
    }
    if (dragRef.current.moved) {
      setOffsetY(clampOffsetY(dragRef.current.origY + dy));
    }
  };

  const handleWallDragEnd = () => {
    dragRef.current.active = false;
  };

  const handleToggleClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setCollapsed((c) => !c);
  };

  const effectivePercent = volState.muted ? 0 : Math.round(volState.volume * 100);
  const AudioIcon =
    effectivePercent === 0 ? VolumeX : effectivePercent < 50 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      style={{ transform: `translateY(${offsetY}px)` }}
      className={`fixed left-0 top-24 z-40 flex items-stretch rounded-r-xl bg-[#13161D]/95 backdrop-blur-md border border-l-0 shadow-2xl overflow-hidden transition-[width,border-color] duration-200 ease-out ${
        collapsed
          ? 'w-8 border-cyan-500/45 hover:border-cyan-400'
          : 'w-60 sm:w-64 border-cyan-500/45'
      }`}
    >
      {/* Left-wall handle with audio icon */}
      <button
        type="button"
        onPointerDown={handleWallDragStart}
        onPointerMove={handleWallDragMove}
        onPointerUp={handleWallDragEnd}
        onPointerCancel={handleWallDragEnd}
        onClick={handleToggleClick}
        className="w-8 shrink-0 bg-[#0F1218] hover:bg-[#1A1E28] border-r border-white/10 py-2.5 px-1 flex flex-col items-center justify-center gap-1 cursor-pointer touch-none select-none"
        title={
          collapsed
            ? `Abrir controle de volume (${effectivePercent}%)`
            : 'Retrair controle de volume na parede esquerda'
        }
        aria-expanded={!collapsed}
      >
        <AudioIcon
          className={`w-3.5 h-3.5 shrink-0 ${
            effectivePercent === 0 ? 'text-red-400' : 'text-cyan-400'
          }`}
        />
        <GripVertical className="w-2.5 h-2.5 text-slate-500 shrink-0" />
        <span className="text-[9px] font-mono font-bold text-slate-300 leading-none">
          {effectivePercent}%
        </span>
      </button>

      {/* Horizontally expanded volume panel */}
      {!collapsed && (
        <div className="flex-1 min-w-0 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <AudioIcon
                className={`w-3.5 h-3.5 shrink-0 ${
                  effectivePercent === 0 ? 'text-red-400' : 'text-cyan-400'
                }`}
              />
              <span className="text-[11px] font-bold text-white truncate">
                Volume do Áudio
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="h-5 w-5 rounded bg-[#1A1E28] hover:bg-white/10 border border-white/10 text-slate-300 inline-flex items-center justify-center cursor-pointer shrink-0"
              title="Retrair volume na parede esquerda"
            >
              <ChevronLeft className="w-3 h-3 text-cyan-400" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setMasterVolumeState({
                  muted: !volState.muted,
                  volume: volState.volume <= 0.01 ? 0.8 : volState.volume,
                })
              }
              className={`h-6 w-6 rounded border inline-flex items-center justify-center shrink-0 cursor-pointer ${
                effectivePercent === 0
                  ? 'bg-red-500/20 border-red-500/40 text-red-300'
                  : 'bg-[#0B0D11] border-white/15 text-cyan-300 hover:bg-white/10'
              }`}
              title={effectivePercent === 0 ? 'Ativar áudio' : 'Silenciar áudio'}
            >
              <AudioIcon className="w-3.5 h-3.5" />
            </button>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={effectivePercent}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setMasterVolumeState({ volume: v, muted: v <= 0 });
              }}
              aria-label="Volume geral do áudio"
              className="flex-1 min-w-0 accent-cyan-400 cursor-pointer"
            />

            <span className="text-[10px] font-mono font-bold text-white w-8 text-right shrink-0">
              {effectivePercent}%
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[
              { label: 'Mudo', pct: 0 },
              { label: '25%', pct: 25 },
              { label: '50%', pct: 50 },
              { label: '100%', pct: 100 },
            ].map((preset) => {
              const active =
                preset.pct === 0
                  ? effectivePercent === 0
                  : Math.abs(effectivePercent - preset.pct) <= 2;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    setMasterVolumeState({
                      volume: preset.pct === 0 ? volState.volume || 0.8 : preset.pct / 100,
                      muted: preset.pct === 0,
                    })
                  }
                  className={`h-5 rounded text-[10px] font-semibold cursor-pointer border ${
                    active
                      ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                      : 'bg-[#0B0D11] border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
