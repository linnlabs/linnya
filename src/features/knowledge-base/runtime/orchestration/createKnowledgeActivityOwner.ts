import {
  KnowledgeActivityBusyError,
  type KnowledgeActivityKind,
  type KnowledgeActivityLease,
} from '../definitions/knowledgeActivity';

interface Activity {
  readonly kbId: string;
  readonly kind: KnowledgeActivityKind;
  readonly exclusive: boolean;
  readonly controller: AbortController;
  readonly completed: Promise<void>;
  complete(): void;
}

/**
 * 单个 Backend 的知识库任务准入。Worker 启动前取得租约，真实结束后才归还。
 * JS Map 只在 owner 使用；不能把各 Worker 内各自的锁误当作跨线程互斥。
 */
export function createKnowledgeActivityOwner() {
  const active = new Set<Activity>();
  let accepting = true;
  let draining: Promise<void> | undefined;

  function begin(kbId: string, kind: KnowledgeActivityKind): KnowledgeActivityLease {
    if (!accepting) throw new Error('知识库正在停用，不能开始新任务');
    const exclusive = kind === 'delete' || kind === 'rebuild' || kind === 'maintenance';
    for (const other of active) {
      if (other.kbId === kbId && (exclusive || other.exclusive)) throw new KnowledgeActivityBusyError(kbId);
    }
    let complete: () => void = () => undefined;
    const completed = new Promise<void>(resolve => { complete = resolve; });
    const activity: Activity = { kbId, kind, exclusive, controller: new AbortController(), completed, complete };
    active.add(activity);
    return {
      signal: activity.controller.signal,
      release() {
        active.delete(activity);
        activity.complete();
      },
    };
  }

  return {
    begin,
    async whenIdle(kbId: string): Promise<void> {
      await Promise.all([...active].filter(item => item.kbId === kbId).map(item => item.completed));
    },
    hasActivity(kbId?: string): boolean { return [...active].some(item => kbId === undefined || item.kbId === kbId); },
    /** 停用只取消本插件的任务；调用方负责将 signal 接到实际 Worker / Host 请求。 */
    drain(): Promise<void> {
      if (draining) return draining;
      accepting = false;
      for (const activity of active) activity.controller.abort();
      draining = Promise.all([...active].map(activity => activity.completed)).then(() => undefined);
      return draining;
    },
  };
}

export type KnowledgeActivityOwner = ReturnType<typeof createKnowledgeActivityOwner>;
