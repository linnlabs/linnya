import type { CanvasElement } from '@plugin/canvas/shared';
export interface CanvasClipboardPort {
  canHandle(): boolean;
  read(): readonly CanvasElement[];
  pasteElements(elements: readonly CanvasElement[]): Promise<void>;
  pasteText(text: string): Promise<void>;
  cut(): Promise<void>;
  fail(error: unknown): void;
}
