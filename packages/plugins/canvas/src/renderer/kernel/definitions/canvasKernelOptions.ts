import type { CanvasKernelIntent } from './canvasKernel';

export interface CanvasKernelOptions {
  readonly host: HTMLElement;
  readonly width?: number;
  readonly height?: number;
  readonly resolution?: number;
  readonly bitmapBudgetBytes?: number;
  readonly onIntent?: (intent: CanvasKernelIntent) => void;
  readonly readonly?: boolean;
  readonly readReadonly?: () => boolean;
  readonly readInteractionPreferences?: () => {
    readonly wheelZoom: boolean;
    readonly snapping: boolean;
  };
  readonly renderingMode?: 'interactive' | 'capture';
}
