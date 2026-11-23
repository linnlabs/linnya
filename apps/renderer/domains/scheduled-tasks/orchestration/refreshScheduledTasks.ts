import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';

let inFlight: Promise<void> | null = null;
let again = false;

/**
 * 重读全部任务。推送可能连着来好几次：正在读时再收到，只在这次读完后补读一次，不并发。
 * 失败只在还没有任何结果时显示错误；已经有结果时保留旧列表，等下一次推送或用户重试。
 */
export function refreshScheduledTasks(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  const store = useScheduledTasksStore();
  store.markLoading();
  inFlight = (async () => {
    try {
      do {
        again = false;
        store.applyList(await scheduledTasksClient.list());
      } while (again);
    } catch (error: unknown) {
      console.warn('[scheduled-tasks] 读取任务失败', error);
      store.markError();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
