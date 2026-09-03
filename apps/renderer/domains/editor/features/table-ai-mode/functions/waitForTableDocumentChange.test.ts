import { describe, expect, it, vi } from 'vitest';
import {
  runAndWaitForTableDocumentChange,
  type TableTransactionEventSource,
} from './waitForTableDocumentChange';

function createTransactionSource() {
  let listener: ((payload: unknown) => void) | null = null;
  const source: TableTransactionEventSource = {
    on: vi.fn((_eventName, handler) => {
      listener = handler;
    }),
    off: vi.fn((_eventName, handler) => {
      if (listener === handler) listener = null;
    }),
  };

  return {
    source,
    emit(payload: unknown) {
      listener?.(payload);
    },
    hasListener: () => listener !== null,
  };
}

describe('runAndWaitForTableDocumentChange', () => {
  it('在操作前注册监听，并捕获操作同步产生的 docChanged 事务', async () => {
    const transaction = createTransactionSource();
    const operation = vi.fn(() => {
      expect(transaction.hasListener()).toBe(true);
      transaction.emit({ transaction: { docChanged: true } });
      return true;
    });

    await expect(runAndWaitForTableDocumentChange(
      transaction.source,
      operation,
      200,
    )).resolves.toBe(true);

    expect(operation).toHaveBeenCalledOnce();
    expect(transaction.source.on).toHaveBeenCalledOnce();
    expect(transaction.source.off).toHaveBeenCalledOnce();
    expect(transaction.hasListener()).toBe(false);
  });

  it('操作未执行成功时立即解绑，不等待超时', async () => {
    const transaction = createTransactionSource();

    await expect(runAndWaitForTableDocumentChange(
      transaction.source,
      () => false,
      10_000,
    )).resolves.toBe(false);

    expect(transaction.source.off).toHaveBeenCalledOnce();
    expect(transaction.hasListener()).toBe(false);
  });
});
