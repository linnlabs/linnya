import type { CanvasCommand, CanvasSnapshot, CanvasTextDocument } from '../../../../shared';
export interface CanvasWriteTextMeasurement {
  readonly ref: string;
  readonly content: CanvasTextDocument;
  readonly width: number;
}
export interface CanvasPreparedOperation {
  readonly command: CanvasCommand;
  readonly measurement?: CanvasWriteTextMeasurement;
}
export interface CanvasWriteOperationContext {
  readonly snapshot: CanvasSnapshot;
  readonly dryRun: boolean;
  readonly operationIndex: number;
  readonly commandIndex: number;
}
