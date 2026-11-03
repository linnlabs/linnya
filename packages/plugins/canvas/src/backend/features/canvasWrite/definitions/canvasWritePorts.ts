import type { CanvasSnapshot, CanvasTextDocument } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';

export interface CanvasWritePorts {
  parseText(markdown: string, baseline?: { readonly elementId: string; readonly revision: number }): Promise<CanvasTextDocument>;
  readBody(elementId: string): string;
  resolveDocument(path: string): Promise<string>;
  prepareImage(file: string, dryRun: boolean): Promise<{ readonly assetId: string; readonly width: number; readonly height: number }>;
  measure(cards: readonly { readonly ref: string; readonly content: CanvasTextDocument; readonly width: number }[], signal: AbortSignal): Promise<readonly { readonly ref: string; readonly height: number }[]>;
}
export interface CanvasWritePreparation {
  readonly snapshot: CanvasSnapshot;
  readonly operations: readonly CanvasCliOperation[];
  readonly dryRun: boolean;
  readonly signal: AbortSignal;
}
