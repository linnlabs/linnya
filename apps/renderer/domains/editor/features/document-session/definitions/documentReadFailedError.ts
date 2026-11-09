import type { UserFacingMessage } from '@app/schemas';

/** 后端读取文档失败；`userMessage` 是后端给出的用户可读原因（如正文损坏、格式不正确）。 */
export class DocumentReadFailedError extends Error {
  constructor(
    message: string,
    readonly userMessage?: UserFacingMessage,
  ) {
    super(message);
    this.name = 'DocumentReadFailedError';
  }
}
