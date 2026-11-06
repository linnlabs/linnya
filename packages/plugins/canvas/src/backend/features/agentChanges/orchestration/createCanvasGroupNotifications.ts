import { CANVAS_AGENT_WRITING_IDLE_MS } from '../definitions/canvasAgentChanges';

/** 静默结束由内容 owner 通知一次；每个表面不再为派生 writing 值重复轮询。 */
export function createCanvasGroupNotifications(options: { readonly publish: (documentId: string) => void; readonly failed: (error: unknown, documentId: string) => void }) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    changed(documentId: string, reason: 'write' | 'review' | 'release'): void {
      if (reason === 'write') {
        clearTimeout(timers.get(documentId));
        const timer = setTimeout(() => {
          timers.delete(documentId);
          try { options.publish(documentId); } catch (error) { options.failed(error, documentId); }
        }, CANVAS_AGENT_WRITING_IDLE_MS);
        timer.unref(); timers.set(documentId, timer);
      }
      options.publish(documentId);
    },
    dispose(): void { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}
