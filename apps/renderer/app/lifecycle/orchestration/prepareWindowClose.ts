import type { WindowClosePreparationResult } from '@linnya/app-lifecycle-contract';

/**
 * 保存失败与异常都必须保持窗口打开。主进程不能用超时猜测保存结果，否则慢磁盘会变成数据丢失。
 */
export async function prepareWindowClose(input: {
  readonly requestSave: () => Promise<boolean>;
  readonly reportUnexpectedFailure: (error: unknown) => void;
}): Promise<WindowClosePreparationResult> {
  try {
    return await input.requestSave() ? 'ready' : 'save_failed';
  } catch (error: unknown) {
    input.reportUnexpectedFailure(error);
    return 'save_failed';
  }
}
