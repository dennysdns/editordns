import { useCallback, useEffect, useRef, useState } from 'react';

export interface StagePan {
  x: number;
  y: number;
}

interface UseStageZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  initialEnabled?: boolean;
  onPinchStart?: () => void;
}

export function useStageZoom(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  options?: UseStageZoomOptions
) {
  const minZoom = options?.minZoom ?? 1;
  const maxZoom = options?.maxZoom ?? 5;

  const [zoomEnabled, setZoomEnabled] = useState(options?.initialEnabled ?? true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<StagePan>({ x: 0, y: 0 });

  const zoomEnabledRef = useRef(zoomEnabled);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const onPinchStartRef = useRef(options?.onPinchStart);

  zoomEnabledRef.current = zoomEnabled;
  zoomRef.current = zoom;
  panRef.current = pan;
  onPinchStartRef.current = options?.onPinchStart;

  const isPinchingRef = useRef(false);
  const lastPinchEndRef = useRef(0);
  const pinchOriginRef = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
    midClientX: number;
    midClientY: number;
  }>({
    dist: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    midClientX: 0,
    midClientY: 0,
  });

  const lastTapRef = useRef<{
    time: number;
    x: number;
    y: number;
  }>({ time: 0, x: 0, y: 0 });

  const panDragRef = useRef<{
    active: boolean;
    moved: boolean;
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  }>({
    active: false,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    origPanX: 0,
    origPanY: 0,
  });

  const clampPan = useCallback(
    (nextPanX: number, nextPanY: number, nextZoom: number, rect: DOMRect): StagePan => {
      if (nextZoom <= 1.005) {
        return { x: 0, y: 0 };
      }
      const minX = rect.width * (1 - nextZoom);
      const minY = rect.height * (1 - nextZoom);
      return {
        x: Math.max(minX, Math.min(0, nextPanX)),
        y: Math.max(minY, Math.min(0, nextPanY)),
      };
    },
    []
  );

  const applyZoomAndPan = useCallback((nextZoom: number, nextPan: StagePan) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  const zoomAtClientPoint = useCallback(
    (targetZoom: number, clientX: number, clientY: number) => {
      const vp = viewportRef.current;
      const clampedZoom = Number(Math.max(minZoom, Math.min(maxZoom, targetZoom)).toFixed(3));
      if (!vp) {
        applyZoomAndPan(clampedZoom, clampedZoom <= 1.005 ? { x: 0, y: 0 } : panRef.current);
        return;
      }
      const rect = vp.getBoundingClientRect();
      if (clampedZoom <= 1.005) {
        applyZoomAndPan(1, { x: 0, y: 0 });
        return;
      }

      const oldZoom = zoomRef.current;
      const oldPan = panRef.current;
      const lx = clientX - rect.left;
      const ly = clientY - rect.top;

      // Unscaled coordinate inside viewport anchored at (clientX, clientY)
      const px = (lx - oldPan.x) / oldZoom;
      const py = (ly - oldPan.y) / oldZoom;

      const rawPanX = lx - px * clampedZoom;
      const rawPanY = ly - py * clampedZoom;
      const nextPan = clampPan(rawPanX, rawPanY, clampedZoom, rect);

      applyZoomAndPan(clampedZoom, nextPan);
    },
    [applyZoomAndPan, clampPan, maxZoom, minZoom, viewportRef]
  );

  const zoomByStep = useCallback(
    (direction: 1 | -1) => {
      const vp = viewportRef.current;
      const factor = direction > 0 ? 1.25 : 1 / 1.25;
      const nextZoom = zoomRef.current * factor;
      if (!vp) {
        const clamped = Number(Math.max(minZoom, Math.min(maxZoom, nextZoom)).toFixed(3));
        applyZoomAndPan(clamped, clamped <= 1.005 ? { x: 0, y: 0 } : panRef.current);
        return;
      }
      const rect = vp.getBoundingClientRect();
      zoomAtClientPoint(nextZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [applyZoomAndPan, maxZoom, minZoom, viewportRef, zoomAtClientPoint]
  );

  const resetZoom = useCallback(() => {
    applyZoomAndPan(1, { x: 0, y: 0 });
  }, [applyZoomAndPan]);

  const startPanDrag = useCallback((clientX: number, clientY: number) => {
    panDragRef.current = {
      active: true,
      moved: false,
      startClientX: clientX,
      startClientY: clientY,
      origPanX: panRef.current.x,
      origPanY: panRef.current.y,
    };
  }, []);

  const movePanDrag = useCallback(
    (clientX: number, clientY: number): boolean => {
      const drag = panDragRef.current;
      if (!drag.active) return false;
      const dx = clientX - drag.startClientX;
      const dy = clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
      }
      const vp = viewportRef.current;
      if (!vp) return true;
      const rect = vp.getBoundingClientRect();
      const clamped = clampPan(drag.origPanX + dx, drag.origPanY + dy, zoomRef.current, rect);
      panRef.current = clamped;
      setPan(clamped);
      return true;
    },
    [clampPan, viewportRef]
  );

  const endPanDrag = useCallback(() => {
    const wasMoved = panDragRef.current.moved;
    panDragRef.current.active = false;
    panDragRef.current.moved = false;
    return wasMoved;
  }, []);

  const handleTouchDoubleTapCheck = useCallback(
    (clientX: number, clientY: number, allowDoubleTap = true) => {
      if (!zoomEnabledRef.current || !allowDoubleTap) return false;
      const now = performance.now();
      const prev = lastTapRef.current;
      const dist = Math.hypot(clientX - prev.x, clientY - prev.y);
      if (now - prev.time < 290 && dist < 28) {
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        if (zoomRef.current > 1.05) {
          resetZoom();
        } else {
          zoomAtClientPoint(2.2, clientX, clientY);
        }
        return true;
      }
      lastTapRef.current = { time: now, x: clientX, y: clientY };
      return false;
    },
    [resetZoom, zoomAtClientPoint]
  );

  // Multi-touch pinch zoom anchored at touch midpoint
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const getTouchMetrics = (touches: TouchList) => {
      const t0 = touches[0];
      const t1 = touches[1];
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      return {
        dist: Math.max(8, Math.hypot(dx, dy)),
        midX: (t0.clientX + t1.clientX) / 2,
        midY: (t0.clientY + t1.clientY) / 2,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!zoomEnabledRef.current) return;
      if (e.touches.length >= 2) {
        e.preventDefault();
        isPinchingRef.current = true;
        panDragRef.current.active = false;
        onPinchStartRef.current?.();
        const { dist, midX, midY } = getTouchMetrics(e.touches);
        pinchOriginRef.current = {
          dist,
          zoom: zoomRef.current,
          panX: panRef.current.x,
          panY: panRef.current.y,
          midClientX: midX,
          midClientY: midY,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!zoomEnabledRef.current) return;
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          onPinchStartRef.current?.();
          const init = getTouchMetrics(e.touches);
          pinchOriginRef.current = {
            dist: init.dist,
            zoom: zoomRef.current,
            panX: panRef.current.x,
            panY: panRef.current.y,
            midClientX: init.midX,
            midClientY: init.midY,
          };
          return;
        }

        const rect = vp.getBoundingClientRect();
        const { dist, midX, midY } = getTouchMetrics(e.touches);
        const orig = pinchOriginRef.current;

        const nextZoom = Number(
          Math.max(minZoom, Math.min(maxZoom, orig.zoom * (dist / orig.dist))).toFixed(3)
        );
        if (nextZoom <= 1.005) {
          applyZoomAndPan(1, { x: 0, y: 0 });
          return;
        }

        // Keep initial midpoint's stage coordinate locked to the current two-finger midpoint
        const origLocalX = orig.midClientX - rect.left;
        const origLocalY = orig.midClientY - rect.top;
        const stagePxX = (origLocalX - orig.panX) / orig.zoom;
        const stagePxY = (origLocalY - orig.panY) / orig.zoom;

        const curLocalX = midX - rect.left;
        const curLocalY = midY - rect.top;

        const rawPanX = curLocalX - stagePxX * nextZoom;
        const rawPanY = curLocalY - stagePxY * nextZoom;
        const clamped = clampPan(rawPanX, rawPanY, nextZoom, rect);

        applyZoomAndPan(nextZoom, clamped);
      }
    };

    const handleTouchEndOrCancel = (e: TouchEvent) => {
      if (isPinchingRef.current && e.touches.length < 2) {
        isPinchingRef.current = false;
        lastPinchEndRef.current = performance.now();
      }
    };

    vp.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    vp.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    vp.addEventListener('touchend', handleTouchEndOrCancel, { capture: true });
    vp.addEventListener('touchcancel', handleTouchEndOrCancel, { capture: true });

    return () => {
      vp.removeEventListener('touchstart', handleTouchStart, { capture: true });
      vp.removeEventListener('touchmove', handleTouchMove, { capture: true });
      vp.removeEventListener('touchend', handleTouchEndOrCancel, { capture: true });
      vp.removeEventListener('touchcancel', handleTouchEndOrCancel, { capture: true });
    };
  }, [applyZoomAndPan, clampPan, maxZoom, minZoom, viewportRef, zoomAtClientPoint]);

  const isMultiTouchBlocked = useCallback(() => {
    if (isPinchingRef.current) return true;
    return performance.now() - lastPinchEndRef.current < 140;
  }, []);

  return {
    zoomEnabled,
    setZoomEnabled,
    zoom,
    pan,
    isPinchingRef,
    panDragRef,
    zoomAtClientPoint,
    zoomByStep,
    resetZoom,
    startPanDrag,
    movePanDrag,
    endPanDrag,
    handleTouchDoubleTapCheck,
    isMultiTouchBlocked,
  };
}
