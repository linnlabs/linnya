/** 一次运行的开始、提问、结束常在几毫秒内连着写；合并成一次，读取方只重读一遍。 */
const COALESCE_DELAY_MS = 50;

/**
 * 把 runs 写入的失效通知转成发给界面的“重读运行状态”信号。不带内容，不区分对话：
 * 读取方重读全工作区列表（候选查询不到 1 ms）。返回值断开订阅并丢弃未发出的信号。
 */
export function connectConversationActivityChanges(input: {
  readonly subscribe: (listener: () => void) => () => void;
  readonly publish: () => void;
  readonly onPublishFailure?: (error: unknown) => void;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    timer = null;
    try {
      input.publish();
    } catch (error: unknown) {
      input.onPublishFailure?.(error);
    }
  };
  const unsubscribe = input.subscribe(() => {
    if (timer) return;
    timer = setTimeout(flush, COALESCE_DELAY_MS);
    timer.unref?.();
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
