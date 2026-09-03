import { describe, expect, it, vi } from 'vitest';

import { prepareWindowClose } from './prepareWindowClose';

describe('prepareWindowClose', () => {
  it('页面看似没有修改时也执行保存钩子，确保录音等外部状态能够落盘', async () => {
    const requestSave = vi.fn(async () => true);
    const reportUnexpectedFailure = vi.fn();

    await expect(prepareWindowClose({
      requestSave,
      reportUnexpectedFailure,
    })).resolves.toBe('ready');
    expect(requestSave).toHaveBeenCalledOnce();
    expect(reportUnexpectedFailure).not.toHaveBeenCalled();
  });

  it('有修改时只有真实保存成功才允许退出', async () => {
    await expect(prepareWindowClose({
      requestSave: async () => true,
      reportUnexpectedFailure: vi.fn(),
    })).resolves.toBe('ready');

    await expect(prepareWindowClose({
      requestSave: async () => false,
      reportUnexpectedFailure: vi.fn(),
    })).resolves.toBe('save_failed');
  });

  it('保存抛错时返回失败，不能留下未处理 rejection 或误发成功确认', async () => {
    const failure = new Error('disk unavailable');
    const reportUnexpectedFailure = vi.fn();
    await expect(prepareWindowClose({
      requestSave: async () => { throw failure; },
      reportUnexpectedFailure,
    })).resolves.toBe('save_failed');
    expect(reportUnexpectedFailure).toHaveBeenCalledWith(failure);
  });
});
