export type StretchEdge = 'n' | 's' | 'e' | 'w';

export interface EdgeHoverTarget {
  id: string;
  edge: StretchEdge;
}

export function toRotatedLocalSpace(
  pt: { x: number; y: number },
  cx: number,
  cy: number,
  rotationDeg: number
): { rx: number; ry: number } {
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  const rad = (-rotationDeg * Math.PI) / 180;
  return {
    rx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ry: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export function detectEdgeHit(
  pt: { x: number; y: number },
  box: {
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
    rotationDeg: number;
  },
  tolerance = 24,
  excludeCornerRadius = 18
): StretchEdge | null {
  const { rx, ry } = toRotatedLocalSpace(pt, box.cx, box.cy, box.rotationDeg);

  // Skip exact corner handle zones when requested so corner resize stays clean
  if (excludeCornerRadius > 0) {
    const corners = [
      [-box.halfW, -box.halfH],
      [box.halfW, -box.halfH],
      [box.halfW, box.halfH],
      [-box.halfW, box.halfH],
    ];
    if (corners.some(([kx, ky]) => Math.hypot(rx - kx, ry - ky) <= excludeCornerRadius)) {
      return null;
    }
  }

  const candidates: Array<{ edge: StretchEdge; dist: number }> = [];
  if (Math.abs(ry) <= box.halfH + 8) {
    const dE = Math.abs(rx - box.halfW);
    if (dE <= tolerance) candidates.push({ edge: 'e', dist: dE });
    const dW = Math.abs(rx + box.halfW);
    if (dW <= tolerance) candidates.push({ edge: 'w', dist: dW });
  }
  if (Math.abs(rx) <= box.halfW + 8) {
    const dS = Math.abs(ry - box.halfH);
    if (dS <= tolerance) candidates.push({ edge: 's', dist: dS });
    const dN = Math.abs(ry + box.halfH);
    if (dN <= tolerance) candidates.push({ edge: 'n', dist: dN });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].edge;
}

export function computeEdgeStretch(params: {
  edge: StretchEdge;
  pt: { x: number; y: number };
  origCx: number;
  origCy: number;
  baseW: number;
  baseH: number;
  origScaleX: number;
  origScaleY: number;
  rotationDeg: number;
}): { scaleX: number; scaleY: number; cx: number; cy: number } {
  const { edge, pt, origCx, origCy, baseW, baseH, origScaleX, origScaleY, rotationDeg } = params;
  const { rx, ry } = toRotatedLocalSpace(pt, origCx, origCy, rotationDeg);

  const origHalfW = (baseW * Math.abs(origScaleX)) / 2;
  const origHalfH = (baseH * Math.abs(origScaleY)) / 2;

  let nextScaleX = origScaleX;
  let nextScaleY = origScaleY;
  let localShiftX = 0;
  let localShiftY = 0;

  if (edge === 'e') {
    const newW = Math.max(24, rx + origHalfW);
    const sign = origScaleX < 0 ? -1 : 1;
    const mag = Math.max(0.08, Math.min(8, newW / Math.max(1, baseW)));
    nextScaleX = Number((mag * sign).toFixed(3));
    localShiftX = (baseW * mag) / 2 - origHalfW;
  } else if (edge === 'w') {
    const newW = Math.max(24, origHalfW - rx);
    const sign = origScaleX < 0 ? -1 : 1;
    const mag = Math.max(0.08, Math.min(8, newW / Math.max(1, baseW)));
    nextScaleX = Number((mag * sign).toFixed(3));
    localShiftX = -((baseW * mag) / 2 - origHalfW);
  } else if (edge === 's') {
    const newH = Math.max(24, ry + origHalfH);
    const sign = origScaleY < 0 ? -1 : 1;
    const mag = Math.max(0.08, Math.min(8, newH / Math.max(1, baseH)));
    nextScaleY = Number((mag * sign).toFixed(3));
    localShiftY = (baseH * mag) / 2 - origHalfH;
  } else if (edge === 'n') {
    const newH = Math.max(24, origHalfH - ry);
    const sign = origScaleY < 0 ? -1 : 1;
    const mag = Math.max(0.08, Math.min(8, newH / Math.max(1, baseH)));
    nextScaleY = Number((mag * sign).toFixed(3));
    localShiftY = -((baseH * mag) / 2 - origHalfH);
  }

  const rotRad = (rotationDeg * Math.PI) / 180;
  const worldShiftX = localShiftX * Math.cos(rotRad) - localShiftY * Math.sin(rotRad);
  const worldShiftY = localShiftX * Math.sin(rotRad) + localShiftY * Math.cos(rotRad);

  return {
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    cx: Math.round(origCx + worldShiftX),
    cy: Math.round(origCy + worldShiftY),
  };
}

export function getEdgeStretchCursor(edge: StretchEdge, rotationDeg: number): string {
  const baseAngle = edge === 'e' || edge === 'w' ? 0 : 90;
  const total = (((baseAngle + rotationDeg) % 180) + 180) % 180;
  if (total < 22.5 || total >= 157.5) return 'ew-resize';
  if (total < 67.5) return 'nwse-resize';
  if (total < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

export function drawEdgeStretchHandles(
  ctx: CanvasRenderingContext2D,
  opts: {
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
    rotationDeg: number;
    hoveredEdge: StretchEdge | null;
    drawPreviewOutline: boolean;
  }
): void {
  const { cx, cy, halfW, halfH, rotationDeg, hoveredEdge, drawPreviewOutline } = opts;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotationDeg * Math.PI) / 180);

  if (drawPreviewOutline) {
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
    ctx.setLineDash([]);
  }

  // Highlight hovered edge line cleanly
  if (hoveredEdge) {
    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (hoveredEdge === 'e') {
      ctx.moveTo(halfW, -halfH);
      ctx.lineTo(halfW, halfH);
    } else if (hoveredEdge === 'w') {
      ctx.moveTo(-halfW, -halfH);
      ctx.lineTo(-halfW, halfH);
    } else if (hoveredEdge === 's') {
      ctx.moveTo(-halfW, halfH);
      ctx.lineTo(halfW, halfH);
    } else {
      ctx.moveTo(-halfW, -halfH);
      ctx.lineTo(halfW, -halfH);
    }
    ctx.stroke();
  }

  const edges: Array<{
    edge: StretchEdge;
    x: number;
    y: number;
    w: number;
    h: number;
    horizontal: boolean;
  }> = [
    { edge: 'e', x: halfW, y: 0, w: 12, h: 36, horizontal: false },
    { edge: 'w', x: -halfW, y: 0, w: 12, h: 36, horizontal: false },
    { edge: 's', x: 0, y: halfH, w: 36, h: 12, horizontal: true },
    { edge: 'n', x: 0, y: -halfH, w: 36, h: 12, horizontal: true },
  ];

  for (const item of edges) {
    // When showing hover preview on an unselected layer/clip, emphasize the hovered edge (and show subtle handles on all edges)
    const active = hoveredEdge === item.edge;
    const pillW = active ? item.w * 1.25 : item.w;
    const pillH = active ? item.h * 1.25 : item.h;

    ctx.fillStyle = '#0B0D11';
    ctx.beginPath();
    ctx.roundRect(item.x - pillW / 2 - 2, item.y - pillH / 2 - 2, pillW + 4, pillH + 4, 6);
    ctx.fill();

    ctx.fillStyle = active ? '#34D399' : '#22D3EE';
    ctx.beginPath();
    ctx.roundRect(item.x - pillW / 2, item.y - pillH / 2, pillW, pillH, 5);
    ctx.fill();

    // Subtle double-grip line inside pill
    ctx.fillStyle = '#0B0D11';
    if (item.horizontal) {
      ctx.fillRect(item.x - 8, item.y - 1.5, 16, 3);
    } else {
      ctx.fillRect(item.x - 1.5, item.y - 8, 3, 16);
    }
  }

  ctx.restore();
}
