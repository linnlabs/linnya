/**
 * 可以直接展示给用户的预览失败：消息已按当前语言生成，不含内部细节。
 * 其他异常（IPC、读取、转换）的原文只进日志，界面只给通用提示。
 */
export class DocumentPreviewUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentPreviewUserError';
  }
}
