export type InteractiveToolStatus = 'active' | 'submitted' | 'skipped' | 'approved' | 'modified';

export type InteractiveToolSubmissionStatus = Exclude<InteractiveToolStatus, 'active'>;

/**
 * 等待用户输入的工具交互身份。
 *
 * 这些字段共同定位一个可恢复的 checkpoint，任何一项缺失都不能执行提交。
 * Host 必须从正式 runtime 事件投影它们，工具卡不得自行生成或猜测。
 */
export interface InteractiveToolActiveMetadata {
  readonly status: 'active';
  readonly interactionId: string;
  readonly runId: string;
  readonly checkpointRevision: number;
  readonly resumeToken: string;
}

export interface InteractiveToolSubmissionMetadata {
  readonly status: InteractiveToolSubmissionStatus;
  readonly submittedAt?: number;
  readonly response?: unknown;
}

/** 工具消息中的交互状态；等待态与已结算态使用判别联合，禁止半完整身份。 */
export type InteractiveToolMetadata =
  | InteractiveToolActiveMetadata
  | InteractiveToolSubmissionMetadata;

export interface ConcludeInteractiveToolInteractionOptions {
  readonly observation: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly data: Record<string, unknown>;
  readonly interactionResponse: InteractiveToolSubmissionMetadata;
}

export interface RendererInteractiveToolPort {
  concludeInteractiveToolInteraction(
    options: ConcludeInteractiveToolInteractionOptions,
  ): Promise<void>;
}

export declare function registerRendererInteractiveToolPort(port: RendererInteractiveToolPort): void;
export declare function clearRendererInteractiveToolPortForTest(): void;
export declare function concludeInteractiveToolInteraction(
  options: ConcludeInteractiveToolInteractionOptions,
): Promise<void>;
