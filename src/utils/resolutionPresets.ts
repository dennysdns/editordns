export interface ResolutionPreset {
  id: '9:16' | '16:9' | '1:1' | '4:5';
  label: string;
  width: number;
  height: number;
  description: string;
}

export const STAGE_RESOLUTIONS: ResolutionPreset[] = [
  { id: '9:16', label: '9:16', width: 1080, height: 1920, description: 'Vertical (1080×1920)' },
  { id: '16:9', label: '16:9', width: 1920, height: 1080, description: 'Horizontal (1920×1080)' },
  { id: '1:1', label: '1:1', width: 1080, height: 1080, description: 'Quadrado (1080×1080)' },
  { id: '4:5', label: '4:5', width: 1080, height: 1350, description: 'Retrato (1080×1350)' },
];

export function getAspectLabel(width: number, height: number): string {
  const match = STAGE_RESOLUTIONS.find((r) => r.width === width && r.height === height);
  if (match) return match.label;
  if (width === height) return '1:1';
  const ratio = width / Math.max(1, height);
  if (Math.abs(ratio - 16 / 9) < 0.08) return '16:9';
  if (Math.abs(ratio - 4 / 5) < 0.06) return '4:5';
  return width > height ? '16:9' : '9:16';
}
