import type { CanvasArrangeOptions } from '../../../../shared/cli/definitions/canvasCli';

export type CanvasCliCommand =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'apply';
      readonly path: string;
      readonly file: string;
      readonly requestId: string;
      readonly dryRun: boolean;
    }
  | {
      readonly kind: 'arrange';
      readonly path: string;
      readonly options: CanvasArrangeOptions;
      readonly requestId: string;
      readonly dryRun: boolean;
    }
  | { readonly kind: 'read'; readonly path: string }
  | { readonly kind: 'check'; readonly path: string }
  | { readonly kind: 'groups'; readonly path: string }
  | {
      readonly kind: 'changes';
      readonly path: string;
      /** 二选一：提交序号之后，或本机时间（UTC 毫秒）以后。 */
      readonly after?: number;
      readonly since?: number;
    }
  | { readonly kind: 'receipt'; readonly path: string; readonly requestId: string }
  | {
      readonly kind: 'show' | 'find' | 'neighbors' | 'region';
      readonly path: string;
      readonly value: string;
      readonly depth: number;
      /** find 的标签、状态筛选：工作区标签名。 */
      readonly tag?: string;
      readonly status?: string;
    }
  | {
      readonly kind: 'render';
      readonly path: string;
      readonly format: 'png' | 'jpeg';
      readonly width: number;
      readonly height: number;
      readonly theme: 'light' | 'dark';
      readonly elementIds?: readonly string[];
      readonly region?: string;
    };

export class CanvasCliFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly operation?: number,
    readonly field?: string
  ) {
    super(message);
    this.name = 'CanvasCliFailure';
  }
}
export type CanvasStandaloneReadCommand =
  | Extract<CanvasCliCommand, { kind: 'read' | 'show' | 'find' | 'neighbors' | 'region' | 'check' }>
  | (Extract<CanvasCliCommand, { kind: 'receipt' }> & { readonly conversationId: string });
