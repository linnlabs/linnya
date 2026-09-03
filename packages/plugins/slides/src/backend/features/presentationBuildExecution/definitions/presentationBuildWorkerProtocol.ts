import type { TypecheckResult } from '../../../sandbox/codegenTypecheck';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import type { MathFormulaErrorCode } from '@plugin/slides/shared';
import type { PresentationComposeCompilationResult } from './presentationBuildExecution';

export const PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION = 4 as const;
export const PRESENTATION_BUILD_SOURCE_MAX_BYTES = 256 * 1024;
export const PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const PRESENTATION_BUILD_MATERIALIZATION_JSON_MAX_BYTES = 64 * 1024 * 1024;
export const PRESENTATION_BUILD_MATERIALIZATION_BINARY_MAX_BYTES = 64 * 1024 * 1024;
export const PRESENTATION_BUILD_MATERIALIZATION_RESULT_MAX_BYTES = 64 * 1024 * 1024;
export const PRESENTATION_BUILD_MATERIALIZATION_SVG_MAX_COUNT = 512;
export const PRESENTATION_BUILD_MATERIALIZATION_SLIDE_MAX_COUNT = 512;
export const PRESENTATION_BUILD_MATERIALIZATION_ELEMENT_MAX_COUNT = 20_000;
export const PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT = 50;
export const PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS = 32 * 1024;
export const PRESENTATION_BUILD_DIAGNOSTIC_MESSAGE_MAX_CHARS = 8 * 1024;
export const PRESENTATION_BUILD_DIAGNOSTIC_SNIPPET_MAX_CHARS = 512;

export interface PresentationBuildWorkerReadyMessage {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'ready';
}

export interface PresentationBuildWorkerTypecheckRequest {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'typecheck';
  readonly requestId: string;
  readonly source: string;
}

export interface PresentationBuildWorkerCompileComposeRequest {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'compile_compose';
  readonly requestId: string;
  readonly payload: SandboxJsonObject;
}

export interface PresentationBuildWorkerMaterializedSvgFallback {
  readonly assetId: string;
  readonly contentHash: string;
  readonly pngBytes: ArrayBuffer;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface PresentationBuildWorkerMaterializeRequest {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'materialize';
  readonly requestId: string;
  readonly deckSpec: SandboxJsonObject;
  readonly svgAssets: readonly SandboxJsonObject[];
  readonly svgFallbacks: readonly PresentationBuildWorkerMaterializedSvgFallback[];
}

export interface PresentationBuildWorkerTypecheckResultMessage {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'typecheck_result';
  readonly requestId: string;
  readonly result: TypecheckResult;
}

export interface PresentationBuildWorkerCompileComposeResultMessage {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'compile_compose_result';
  readonly requestId: string;
  readonly result: PresentationComposeCompilationResult;
}

export interface PresentationBuildWorkerMaterializeResultMessage {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'materialize_result';
  readonly requestId: string;
  readonly buffer: ArrayBuffer;
}

interface PresentationBuildWorkerFailureMessageBase {
  readonly protocolVersion: typeof PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION;
  readonly type: 'failure';
  readonly requestId: string;
  readonly message: string;
}

export interface PresentationBuildWorkerExecutionFailureMessage
  extends PresentationBuildWorkerFailureMessageBase {
  readonly failure: { readonly kind: 'execution' };
}

export interface PresentationBuildWorkerFormulaFailureMessage
  extends PresentationBuildWorkerFailureMessageBase {
  readonly failure: {
    readonly kind: 'formula';
    readonly code: MathFormulaErrorCode;
  };
}

export type PresentationBuildWorkerFailureMessage =
  | PresentationBuildWorkerExecutionFailureMessage
  | PresentationBuildWorkerFormulaFailureMessage;

export type PresentationBuildWorkerRequest =
  | PresentationBuildWorkerTypecheckRequest
  | PresentationBuildWorkerCompileComposeRequest
  | PresentationBuildWorkerMaterializeRequest;

export type PresentationBuildWorkerResponse =
  | PresentationBuildWorkerReadyMessage
  | PresentationBuildWorkerTypecheckResultMessage
  | PresentationBuildWorkerCompileComposeResultMessage
  | PresentationBuildWorkerMaterializeResultMessage
  | PresentationBuildWorkerFailureMessage;
