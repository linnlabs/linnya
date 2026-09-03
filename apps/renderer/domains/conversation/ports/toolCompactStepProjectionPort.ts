import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
} from '@linnya/plugin-host-contract/renderer/toolUi';

type OmitUiKey<T> = T extends ToolCompactStepProjectorInput ? Omit<T, 'uiKey'> : never;

export type ToolCompactStepProjectionRequest = OmitUiKey<ToolCompactStepProjectorInput>;

export interface ToolCompactStepProjectionFailureContext {
  readonly sourceToolName: string;
  readonly uiKey?: string;
  readonly toolCallId: string;
  readonly status: ToolCompactStepProjectionRequest['status'];
  readonly phase: ToolCompactStepProjectionRequest['phase'];
}

export class ToolCompactStepProjectionError extends Error {
  readonly cause: unknown;

  constructor(
    readonly context: ToolCompactStepProjectionFailureContext,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Compact step projector failed: tool=${context.sourceToolName}, ui=${context.uiKey ?? 'unresolved'}, call=${context.toolCallId}, reason=${reason}`,
    );
    this.name = 'ToolCompactStepProjectionError';
    this.cause = cause;
  }
}

export interface ToolCompactStepProjectionPort {
  /** 未注册工具或未声明 compact projector 时返回 undefined；合同错误必须原样抛出。 */
  project(request: ToolCompactStepProjectionRequest): ToolCompactStepPresentation | undefined;
}

let registeredPort: ToolCompactStepProjectionPort | null = null;

/** app-level 插件编排安装唯一实现；返回值只用于测试与 Host 卸载。 */
export function registerToolCompactStepProjectionPort(
  port: ToolCompactStepProjectionPort,
): () => void {
  registeredPort = port;
  return () => {
    if (registeredPort === port) registeredPort = null;
  };
}

/** Subrun compact admission 的唯一跨 domain 入口。 */
export function projectToolCompactStep(
  request: ToolCompactStepProjectionRequest,
): ToolCompactStepPresentation | undefined {
  return registeredPort?.project(request);
}
