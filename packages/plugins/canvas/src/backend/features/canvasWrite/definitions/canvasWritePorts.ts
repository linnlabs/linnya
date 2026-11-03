import type { CanvasSnapshot, CanvasTextDocument } from '../../../../shared';
import type { CanvasWriteTextMeasurement } from './canvasPreparedOperation';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';

export interface CanvasWritePorts {
  parseText(markdown: string, baseline?: { readonly elementId: string; readonly revision: number; readonly mode: 'replace' | 'append' }): Promise<CanvasTextDocument>;
  resolveDocument(path: string): Promise<string>;
  prepareImage(file: string, dryRun: boolean): Promise<{ readonly assetId: string; readonly width: number; readonly height: number }>;
  measure(cards: readonly CanvasWriteTextMeasurement[], signal: AbortSignal): Promise<readonly { readonly ref: string; readonly height: number }[]>;
}
export interface CanvasWritePreparation {
  readonly snapshot: CanvasSnapshot;
  readonly operations: readonly CanvasCliOperation[];
  readonly dryRun: boolean;
  readonly signal: AbortSignal;
}
