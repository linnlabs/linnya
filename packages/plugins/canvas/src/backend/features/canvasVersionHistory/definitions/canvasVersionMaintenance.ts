import type { CanvasVersionHead } from './canvasVersionHistory';

export const CANVAS_VERSION_IDLE_MS = 30_000;
export const CANVAS_VERSION_DEADLINE_MS = 600_000;
export const CANVAS_VERSION_MAINTENANCE_DELAY_MS = 1000;

/** 只协调已提交版本的计时和维护，不持有正文、SQL 或剪裁规则。 */
export interface CanvasVersionMaintenanceOptions {
  readonly now: () => number;
  readonly readHead: (documentId: string) => Pick<CanvasVersionHead, 'changedAt' | 'dirtySince'> | null;
  readonly dirtyDocuments: () => readonly string[];
  readonly checkpoint: (documentId: string, reason: 'idle' | 'interval' | 'close') => void;
  readonly compact: (documentId: string) => void;
  readonly reportFailure: (documentId: string, error: unknown) => void;
}
