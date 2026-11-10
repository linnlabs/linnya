import { expect, it, vi } from 'vitest';
import { CanvasDeliveryUnknownError } from '..';
import { createCanvasMutationQueue } from '../orchestration/createCanvasMutationQueue';

it('成功回包丢失时保留原请求等待确认，后续意图排队，重试不重复创建', async () => {
  const queue = createCanvasMutationQueue(), receipts = new Map<string, number>(); let creates = 0;
  const request = Object.freeze({ requestId: 'first', content: '第一版' });
  const send = vi.fn(async () => { if (!receipts.has(request.requestId)) receipts.set(request.requestId, ++creates); if (send.mock.calls.length === 1) throw new CanvasDeliveryUnknownError('response lost'); return receipts.get(request.requestId); });
  const accept = vi.fn(async () => {}), later = vi.fn(async () => 'later');
  const first = queue.execute({ send, accept }), second = queue.execute({ send: later, accept: async () => {} });
  await vi.waitFor(() => expect(queue.state.notice.value).not.toBeNull());
  expect(later).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled(); expect(creates).toBe(1);
  await queue.retry(); expect(await first).toBe(1); expect(await second).toBe('later');
  expect(creates).toBe(1); expect(send).toHaveBeenCalledTimes(2); expect(accept).toHaveBeenCalledOnce();
});
it('有成功回执但补拉失败时只重试接纳；明确拒绝与关闭不会锁死后续通道', async () => {
  const queue = createCanvasMutationQueue(), send = vi.fn(async () => 7), accept = vi.fn(async () => {});
  accept.mockRejectedValueOnce(new Error('changes unavailable'));
  const pending = queue.execute({ send, accept }); await vi.waitFor(() => expect(queue.state.notice.value).toContain('已提交'));
  await queue.retry(); expect(await pending).toBe(7); expect(send).toHaveBeenCalledOnce(); expect(accept).toHaveBeenCalledTimes(2);
  await expect(queue.execute({ send: async () => { throw new Error('permission_denied'); }, accept: async () => {} })).rejects.toThrow('permission_denied');
  const unknown = queue.execute({ send: async () => { throw new CanvasDeliveryUnknownError('lost'); }, accept: async () => {} });
  const rejected = expect(unknown).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(queue.state.notice.value).not.toBeNull()); queue.reset(); await rejected;
  expect(await queue.execute({ send: async () => 8, accept: async () => {} })).toBe(8);
});
