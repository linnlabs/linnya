import type { CanvasElement, CanvasElementId, CanvasPoint } from '@plugin/canvas/shared';
export interface CanvasClipboardPort {
  canHandle(): boolean;
  canWrite(): boolean;
  read(): readonly CanvasElement[];
  prepare(
    elementIds: readonly CanvasElementId[]
  ): Promise<{ readonly elements: readonly CanvasElement[]; readonly text: string }>;
  pastePoint(): CanvasPoint;
  pasteElements(elements: readonly CanvasElement[], point: CanvasPoint): Promise<void>;
  pasteText(text: string, point: CanvasPoint): Promise<void>;
  pasteImages(files: readonly File[], point: CanvasPoint): Promise<void>;
  cut(elements: readonly CanvasElement[]): Promise<void>;
  fail(error: unknown): void;
}
