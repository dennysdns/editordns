import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, RotateCcw } from 'lucide-react';

interface AerialTimelineProps {
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const AerialTimeline: React.FC<AerialTimelineProps> = ({
  title,
  subtitle,
  headerExtra,
  children,
  defaultCollapsed = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
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

  const clampOffsetY = (ny: number) => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const h = containerRef.current?.getBoundingClientRect().height || 140;
    const maxUp = Math.max(60, vh - h - 72);
    return Math.max(-maxUp, Math.min(12, ny));
  };

  useEffect(() => {
    const onResize = () => {
      setOffsetY((prev) => clampOffsetY(prev));
    };
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
        // ignore if pointer already released
      }
    }
    if (dragRef.current.moved) {
      setOffsetY(clampOffsetY(dragRef.current.origY + dy));
    }
  };

  const handleWallDragEnd = () => {
    dragRef.current.active = false;
  };

  const handleHandleClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setCollapsed((c) => !c);
  };

  return (
    <div
      ref={containerRef}
      style={{ transform: `translateY(${offsetY}px)` }}
      className={`fixed left-0 bottom-13 lg:bottom-3 z-40 flex items-stretch rounded-r-xl bg-[#13161D]/95 backdrop-blur-md border border-l-0 shadow-2xl overflow-hidden transition-[width,border-color] duration-200 ease-out ${
        collapsed
          ? 'w-8 border-amber-500/50 hover:border-amber-400'
          : 'w-[calc(100%-8px)] lg:w-[min(95%,1240px)] border-amber-500/40'
      }`}
    >
      {/* Left-wall vertical drawer handle (embedded on left edge, expands horizontally) */}
      <button
        type="button"
        onPointerDown={handleWallDragStart}
        onPointerMove={handleWallDragMove}
        onPointerUp={handleWallDragEnd}
        onPointerCancel={handleWallDragEnd}
        onClick={handleHandleClick}
        className="w-8 shrink-0 bg-[#0F1218] hover:bg-[#1A1E28] border-r border-white/10 py-3 px-1 flex flex-col items-center justify-center gap-1.5 cursor-pointer touch-none select-none"
        title={collapsed ? `Abrir ${title} na horizontal` : `Retrair ${title} na parede esquerda`}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <GripVertical className="w-3 h-3 text-slate-500 shrink-0" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold tracking-wider text-slate-200 uppercase">
          Timeline
        </span>
      </button>

      {/* Horizontally expanded timeline content */}
      {!collapsed && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 border-b border-white/8 select-none">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-bold text-white truncate">{title}</span>
              {subtitle && (
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline truncate">
                  {subtitle}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {headerExtra}

              {offsetY !== 0 && (
                <button
                  type="button"
                  onClick={() => setOffsetY(0)}
                  className="h-6 px-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-slate-300 inline-flex items-center gap-1 cursor-pointer"
                  title="Voltar posição na parede esquerda"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="h-6 px-2 rounded bg-[#1A1E28] hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                title="Retrair linha do tempo na parede esquerda"
              >
                <ChevronLeft className="w-3 h-3 text-amber-400" />
                <span>Retrair</span>
              </button>
            </div>
          </div>

          <div className="p-2 space-y-1.5 max-h-[38vh] overflow-y-auto">{children}</div>
        </div>
      )}
    </div>
  );
};
