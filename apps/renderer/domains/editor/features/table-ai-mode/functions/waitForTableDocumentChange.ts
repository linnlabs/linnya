export interface TableTransactionEventSource {
  on(eventName: 'transaction', handler: (payload: unknown) => void): void;
  off(eventName: 'transaction', handler: (payload: unknown) => void): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasDocumentChange(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isRecord(payload.transaction) && payload.transaction.docChanged === true) return true;
  return payload.docChanged === true;
}

/**
 * 先监听事务，再执行会同步 dispatch 的表格操作。
 * 超时只结束等待，不改变 operation 已成功的业务结论。
 */
export function runAndWaitForTableDocumentChange(
  source: TableTransactionEventSource,
  operation: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (operationSucceeded: boolean) => {
      if (settled) return;
      settled = true;
      source.off('transaction', onTransaction);
      if (timer) clearTimeout(timer);
      resolve(operationSucceeded);
    };
    const onTransaction = (payload: unknown) => {
      if (hasDocumentChange(payload)) finish(true);
    };

    source.on('transaction', onTransaction);
    timer = setTimeout(() => finish(true), timeoutMs);

    try {
      if (!operation()) finish(false);
    } catch (error) {
      if (!settled) {
        settled = true;
        source.off('transaction', onTransaction);
        clearTimeout(timer);
      }
      reject(error);
    }
  });
}
