export type MarkdownParseReason = 'immediate' | 'throttled';

export interface MarkdownParseScheduler {
  update(markdown: string, mode: MarkdownParseReason): void;
  /**
   * 暂停期间只保留最新正文，不解析、不提交 AST；恢复时立即提交一次最新正文。
   * 用于让流式 Markdown DOM 更新避开内容列连续变宽/变窄的布局事务。
   */
  setSuspended(suspended: boolean): void;
  dispose(): void;
}

/**
 * 会话 Markdown 的解析调度合同。
 *
 * streaming 结束是一个正式提交边界：必须立即取消尚未执行的节流任务并解析最新正文。
 * 同一正文一旦提交过 AST，就不能因为 run 状态变化再次提交，否则 Vue 会在答案完成后
 * 无意义地替换整组节点，并触发虚拟行二次测量。
 */
export function createMarkdownParseScheduler(input: {
  readonly throttleMs: number;
  readonly parse: (markdown: string, reason: MarkdownParseReason) => void;
}): MarkdownParseScheduler {
  let lastParsedMarkdown: string | null = null;
  let pendingMarkdown: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suspended = false;
  let disposed = false;

  const clearPendingTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const commit = (markdown: string, reason: MarkdownParseReason): void => {
    if (lastParsedMarkdown === markdown) return;
    input.parse(markdown, reason);
    lastParsedMarkdown = markdown;
  };

  return {
    update(markdown, mode) {
      if (disposed) return;
      pendingMarkdown = markdown;
      if (suspended) {
        clearPendingTimer();
        return;
      }
      if (mode === 'immediate') {
        clearPendingTimer();
        pendingMarkdown = null;
        commit(markdown, 'immediate');
        return;
      }

      if (lastParsedMarkdown === markdown || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const latest = pendingMarkdown;
        pendingMarkdown = null;
        if (latest !== null) commit(latest, 'throttled');
      }, input.throttleMs);
    },
    setSuspended(nextSuspended) {
      if (disposed || suspended === nextSuspended) return;
      suspended = nextSuspended;
      if (suspended) {
        clearPendingTimer();
        return;
      }

      const latest = pendingMarkdown;
      pendingMarkdown = null;
      if (latest !== null) commit(latest, 'immediate');
    },
    dispose() {
      disposed = true;
      clearPendingTimer();
      pendingMarkdown = null;
    },
  };
}
