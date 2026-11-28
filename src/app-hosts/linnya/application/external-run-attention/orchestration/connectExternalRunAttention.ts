import type { ExternalRunAttentionPorts } from '../definitions/externalRunAttention';
import { selectWaitingEpisodes, waitingEpisodeKey } from '../functions/selectWaitingEpisodes';

/** 运行状态与审批的变化常在几毫秒内连着来；合并成一次检查。 */
const COALESCE_DELAY_MS = 50;

/**
 * 外部入口发起的运行开始等用户时通知一次。`subscribe` 接运行状态与审批变化的失效信号（不带内容），
 * 每次重读全工作区运行状态，对新出现的等待各发一条；同一段等待不重复发，结束后再次等待会再发。
 * 发过哪些只记在内存里：App 重启后遗留运行会被收口成中断，不存在跨重启仍在等的运行。
 * 返回值断开订阅。
 */
export function connectExternalRunAttention(input: {
  readonly subscribe: (listener: () => void) => () => void;
  readonly ports: ExternalRunAttentionPorts;
}): () => void {
  const { ports } = input;
  /** 对话 → 已处理的那段等待。用户自己发起的运行也记下，免得每次变化都重查发件人。 */
  let handled: ReadonlyMap<string, string> = new Map();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let checking = false;
  let pending = false;
  let stopped = false;

  async function check(): Promise<void> {
    const waiting = selectWaitingEpisodes(await ports.listActivities());
    const next = new Map<string, string>();
    for (const episode of waiting) {
      const key = waitingEpisodeKey(episode);
      next.set(episode.conversationId, key);
      if (handled.get(episode.conversationId) === key) continue;
      const sender = ports.readExternalSender(episode.runId);
      if (!sender) continue;
      await ports.notify({
        kind: episode.kind,
        conversation_id: episode.conversationId,
        project_id: episode.projectId,
        conversation_title: await ports.readConversationTitle(episode.conversationId),
        sender,
      }).catch(error => ports.logError('External run attention notification unavailable', error));
    }
    handled = next;
  }

  async function drain(): Promise<void> {
    checking = true;
    try {
      do {
        pending = false;
        await check().catch(error => ports.logError('External run attention check failed', error));
      } while (pending && !stopped);
    } finally {
      checking = false;
    }
  }

  const unsubscribe = input.subscribe(() => {
    // 检查进行中来的信号在结束后补查一次，不并发读取。
    if (checking) {
      pending = true;
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, COALESCE_DELAY_MS);
    timer.unref?.();
  });

  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
