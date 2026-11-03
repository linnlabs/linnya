import type { CanvasArrangeRequest } from '@plugin/canvas/shared';
export function canvasLayoutPreset(value: unknown): CanvasArrangeRequest['options'] {
  switch (value) {
    case 'tree-right': return { algorithm: 'tree', direction: 'right' };
    case 'tree-down': return { algorithm: 'tree', direction: 'down' };
    case 'grid': return { algorithm: 'grid', direction: 'right' };
    case 'layered-right': return { algorithm: 'layered', direction: 'right' };
    case 'layered-down': return { algorithm: 'layered', direction: 'down' };
    default: throw new Error('未知排布方式');
  }
}
