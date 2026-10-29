import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
export function createInsertedObject(kind: 'text' | 'rect' | 'ellipse', size: { width: number; height: number }, content: string, editKey: string): SlidesInsertedObject {
  const w = Math.min(kind === 'text' ? 4 : 2, size.width * 0.8);
  const h = Math.min(kind === 'text' ? 0.65 : 2, size.height * 0.8);
  const base = { editKey, box: { x: (size.width - w) / 2, y: (size.height - h) / 2, w, h } };
  return kind === 'text' ? { ...base, kind: 'text', content, style: { fontSize: 28, color: '#111827' } }
    : { ...base, kind: 'shape', geometry: kind, fill: '#2563EB', content: '' };
}
