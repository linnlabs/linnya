import type { CanvasKernelIntent } from '../../../definitions/canvasKernel';
import type { CanvasIdentityAtlas } from '../CanvasIdentityAtlas';

export interface CanvasFrameDrawingOptions {
  readonly readIdentities: () => Pick<CanvasIdentityAtlas, 'needsPreparation' | 'flush'>;
  readonly readCaptureFrame: () => CanvasCaptureFrame;
  readonly restored: () => void;
  readonly software: boolean;
  readonly notify?: (intent: CanvasKernelIntent) => void;
}
export interface CanvasCaptureFrame {
  readonly width: number;
  readonly height: number;
  readonly background: number;
}
