export interface OnDemandQdrantRuntime {
  ensureReady(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * 首个向量请求启动固定的受管进程；并发请求共享同一结果。
 * 启动失败保留原因，不能让每个搜索请求反复拉起故障进程。重新启用建立新的 owner。
 */
export function createOnDemandQdrantRuntime(owner: {
  start(): Promise<string>;
  stop(): Promise<void>;
}): OnDemandQdrantRuntime {
  let start: Promise<string> | undefined;
  let stopping: Promise<void> | undefined;
  let accepting = true;
  return {
    ensureReady() {
      if (!accepting) return Promise.reject(new Error('向量服务正在停止，不能接收新请求'));
      start ??= owner.start();
      return start;
    },
    stop() {
      accepting = false;
      // 等待正在进行的启动结算，再收口同一 owner，避免关停后才出现孤儿进程。
      stopping ??= (async () => {
        if (!start) return;
        await start.catch(() => undefined);
        await owner.stop();
      })().catch(error => {
        // 清理失败仍保留 owner，允许正式退出流程重试；不重新接单。
        stopping = undefined;
        throw error;
      });
      return stopping;
    },
  };
}
