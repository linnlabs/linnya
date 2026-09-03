import type { RuntimeResourceRef } from '../../../../contracts';
import type { ToolExecutionContext } from '../../toolExecutionContext';

/**
 * 工具对模型输入附件的声明。
 *
 * 中文说明：
 * - 这里只表达工具选择了哪个资源，不代表资源已经可信或可读；
 * - `uri` 的协议、作用域与完整性由 host resolver 校验；
 * - path、bytes、base64 和 durable ref 都不属于工具声明面。
 */
export interface ToolModelInputAttachmentSelection {
  readonly id: string;
  readonly uri: string;
  readonly label?: string;
}

export interface ToolModelInputDeclaration {
  readonly attachments: readonly ToolModelInputAttachmentSelection[];
}

export interface ResolveToolModelInputParams {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly selections: readonly ToolModelInputAttachmentSelection[];
  readonly context: ToolExecutionContext;
}

export interface CompleteToolModelInputParams {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly context: ToolExecutionContext;
}

/**
 * host 把不可信 selection 解析为 durable resource ref 的唯一端口。
 * framework 不知道 host 存储、资源路径或授权规则。
 */
export interface ToolModelInputResolverPort {
  resolveToolModelInput(
    params: ResolveToolModelInputParams,
  ): Promise<readonly RuntimeResourceRef[]>;

  /**
   * 一次工具调用完成后释放尚未消费的临时模型输入授权。
   *
   * framework 只表达调用生命周期，不知道 host 使用的是 claim、lease 或其他机制。
   */
  completeToolModelInput(params: CompleteToolModelInputParams): Promise<void>;
}

export class ToolModelInputResolutionError extends Error {
  readonly name = 'ToolModelInputResolutionError';
  readonly errorCode = 'tool.model_input.resolution_failed';

  constructor(message: string) {
    super(message);
  }
}
