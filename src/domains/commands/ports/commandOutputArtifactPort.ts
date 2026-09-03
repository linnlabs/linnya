import type {
  CommandOutputArtifactAppendResult,
  CommandOutputArtifactChunk,
  CommandOutputArtifactDiscardResult,
  CommandOutputArtifactFailure,
  CommandOutputArtifactFinalizationResult,
  CommandOutputArtifactFinalizeRequest,
  CommandOutputArtifactOpenRequest,
  CommandOutputArtifactOwner,
  CommandExecutionMode,
} from '../definitions/commandOutputArtifact';

/**
 * 一个 writer 只属于一条 command execution。首次持续性写入失败后，它必须停止文件 I/O，
 * 但调用方仍会继续 drain 系统 pipe；失败不能被转换成命令退出或取消。
 */
export interface CommandOutputArtifactWriter {
  readonly owner: CommandOutputArtifactOwner;
  readonly mode: CommandExecutionMode;
  /** mode/channel 不匹配、重复或乱序 sequence 属于合同错误，必须在文件 I/O 前拒绝。 */
  /**
   * 同步完成合同校验与有界准入，不能等待磁盘。接纳只表示 writer 已取得 byte 所有权；
   * 是否完整落盘以 finalize manifest 为准，避免慢存储反向堵住系统 pipe。
   */
  append(chunk: CommandOutputArtifactChunk): CommandOutputArtifactAppendResult;
  /**
   * host 已打开 artifact、但业务进程确定尚未启动时，关闭本 writer 的文件并删除空目录。
   * 接收过任何合法输出后必须走 finalize，不能借此丢弃真实 byte。
   */
  discardBeforeSourceStart(): Promise<CommandOutputArtifactDiscardResult>;
  finalize(
    request: CommandOutputArtifactFinalizeRequest,
  ): Promise<CommandOutputArtifactFinalizationResult>;
}

export type CommandOutputArtifactOpenResult =
  | { readonly status: 'opened'; readonly writer: CommandOutputArtifactWriter }
  | { readonly status: 'unavailable'; readonly failure: CommandOutputArtifactFailure };

export interface CommandOutputArtifactPort {
  /** 预期的存储失败使用结果联合返回；合同/编程错误仍应明确抛出。 */
  open(request: CommandOutputArtifactOpenRequest): Promise<CommandOutputArtifactOpenResult>;
}
