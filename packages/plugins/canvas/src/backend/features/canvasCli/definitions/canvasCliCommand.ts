import type { CanvasArrangeOptions } from '../../../../shared/cli/definitions/canvasCli';

export type CanvasCliCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'apply'; readonly path: string; readonly file: string; readonly requestId: string; readonly dryRun: boolean }
  | { readonly kind: 'arrange'; readonly path: string; readonly options: CanvasArrangeOptions; readonly requestId: string; readonly dryRun: boolean }
  | { readonly kind: 'read'; readonly path: string }
  | { readonly kind: 'check'; readonly path: string }
  | { readonly kind: 'groups'; readonly path: string }
  | { readonly kind: 'show' | 'find' | 'neighbors' | 'region'; readonly path: string; readonly value: string; readonly depth: number }
  | { readonly kind: 'render'; readonly path: string; readonly format: 'png' | 'jpeg'; readonly width: number; readonly height: number; readonly theme: 'light' | 'dark'; readonly elementIds?: readonly string[]; readonly region?: string };

export class CanvasCliFailure extends Error {
  constructor(readonly code: string, message: string, readonly operation?: number, readonly field?: string) { super(message); this.name = 'CanvasCliFailure'; }
}
