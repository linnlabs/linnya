import { expect, it, vi } from 'vitest';
import { createCanvasGroupNotifications } from '..';

it('连续写入只在静默结束推送一次，停用清理计时器并记录通知失败', async () => {
  vi.useFakeTimers();
  const publish = vi.fn(), failed = vi.fn();
  const notifications = createCanvasGroupNotifications({ publish, failed });
  try {
    notifications.changed('doc', 'write');
    await vi.advanceTimersByTimeAsync(2000);
    notifications.changed('doc', 'write');
    await vi.advanceTimersByTimeAsync(2999); expect(publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(publish).toHaveBeenCalledTimes(3);
    notifications.changed('doc', 'write');
    publish.mockImplementationOnce(() => { throw new Error('push unavailable'); });
    await vi.advanceTimersByTimeAsync(3000);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'push unavailable' }), 'doc');
    notifications.changed('doc', 'write'); notifications.dispose();
    const count = publish.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000); expect(publish).toHaveBeenCalledTimes(count);
  } finally { notifications.dispose(); vi.useRealTimers(); }
});
