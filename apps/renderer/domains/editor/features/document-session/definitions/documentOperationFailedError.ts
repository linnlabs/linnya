import type { UserFacingMessage } from '@app/schemas';

/**
 * 后端读取或提交文档失败。`message` 是后端原文（只用于日志排查）；`userMessage` 是后端给出的用户可读原因，
 * 如正文损坏、格式不正确、正文里有无法保存的引用。界面优先显示 `userMessage`。
 */
export class DocumentOperationFailedError extends Error {
  constructor(
    message: string,
    readonly userMessage?: UserFacingMessage,
  ) {
    super(message);
    this.name = 'DocumentOperationFailedError';
  }
}
