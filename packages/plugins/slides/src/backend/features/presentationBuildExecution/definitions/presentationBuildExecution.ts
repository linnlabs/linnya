import type { TypecheckResult } from '../../../sandbox/codegenTypecheck';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import type {
  DeckSpec,
  MathFormulaErrorCode,
  SvgGraphicResolvedAsset,
} from '@plugin/slides/shared';

export interface PresentationTypecheckExecutionPort {
  typecheckCodegenSource(source: string): Promise<TypecheckResult>;
}

export type PresentationComposeCompilationResult =
  | {
    readonly ok: true;
    readonly input: SandboxJsonObject;
  }
  | {
    readonly ok: false;
    readonly kind: 'compose_contract' | 'layout_unavailable';
    readonly message: string;
  };

export interface PresentationComposeExecutionPort {
  compileComposePayload(
    payload: SandboxJsonObject,
  ): Promise<PresentationComposeCompilationResult>;
}

/** 仅进程内诊断，不属于 Worker wire result、draft 或工具输出合同。 */
export interface PresentationComposeDiagnosticsPort {
  recordRuntimeFailure(failure: {
    readonly phase: 'layout_initialize' | 'compose_layout';
    readonly slideCount: number;
    readonly error: unknown;
  }): void;
}

export interface PresentationMaterializedSvgFallback {
  readonly assetId: string;
  readonly contentHash: string;
  readonly pngBytes: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Host I/O 和 hidden renderer 已完成后的纯计算输入。
 * 这里不允许出现数据库句柄、文件路径 resolver 或浏览器能力引用。
 */
export interface PresentationMaterializationInput {
  readonly deckSpec: DeckSpec;
  readonly svgAssets: readonly SvgGraphicResolvedAsset[];
  readonly svgFallbacks: readonly PresentationMaterializedSvgFallback[];
}

export interface PresentationMaterializationExecutionPort {
  materializePresentation(
    input: PresentationMaterializationInput,
  ): Promise<ArrayBuffer>;
}

export interface PresentationBuildExecutionPort
  extends
    PresentationTypecheckExecutionPort,
    PresentationComposeExecutionPort,
    PresentationMaterializationExecutionPort {}

export interface PresentationBuildExecutionRuntime extends PresentationBuildExecutionPort {
  close(): Promise<void>;
}

export type PresentationBuildExecutionFailureKind =
  | 'busy'
  | 'closed'
  | 'contract'
  | 'formula'
  | 'protocol'
  | 'timeout'
  | 'unavailable';

export class PresentationBuildExecutionError extends Error {
  readonly name = 'PresentationBuildExecutionError';

  constructor(
    readonly kind: PresentationBuildExecutionFailureKind,
    message: string,
  ) {
    super(message);
  }
}

export class PresentationFormulaBuildExecutionError extends PresentationBuildExecutionError {
  constructor(
    readonly formulaCode: MathFormulaErrorCode,
    message: string,
  ) {
    super('formula', message);
  }
}
