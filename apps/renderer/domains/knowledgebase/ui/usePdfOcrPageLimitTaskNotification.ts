import { watch } from 'vue';
import { useNotificationStore } from '@/app/notification';
import { isPdfOcrPageLimitMessage } from '../functions/pdfOcrPageLimitPresentation';

type UploadTaskLike = {
  id?: unknown;
  status?: unknown;
  error?: unknown;
};

function isTerminalFailedStatus(status: unknown): boolean {
  return status === 'failed' || status === 'error';
}

function readTaskId(task: UploadTaskLike): string | null {
  return typeof task.id === 'string' && task.id.length > 0 ? task.id : null;
}

function readTaskError(task: UploadTaskLike): string | null {
  return typeof task.error === 'string' && task.error.trim().length > 0 ? task.error.trim() : null;
}

/**
 * 监听 OCR 页数上限失败并弹出通知。
 *
 * 为什么放在页面级 composable：
 * - 上传 Tab 会在切换标签页时卸载；
 * - 后台解析失败由 IPC 异步推送，不能绑在易卸载的 Tab 组件更新周期里触发全局通知；
 * - 页面容器生命周期更稳定，能避免切 Tab 时和 Vue patch 互相打架。
 */
export function usePdfOcrPageLimitTaskNotification(args: {
  getUploadTasks: () => Iterable<UploadTaskLike>;
}): void {
  const notificationStore = useNotificationStore();
  const notifiedTaskIds = new Set<string>();

  watch(
    () => Array.from(args.getUploadTasks(), (task) => ({
      id: readTaskId(task),
      status: task.status,
      error: readTaskError(task),
    })),
    (tasks) => {
      for (const task of tasks) {
        if (
          !task.id ||
          !task.error ||
          !isTerminalFailedStatus(task.status) ||
          !isPdfOcrPageLimitMessage(task.error) ||
          notifiedTaskIds.has(task.id)
        ) {
          continue;
        }

        notifiedTaskIds.add(task.id);
        notificationStore.show(task.error, 'warning', 6500);
      }
    },
    { flush: 'post' }
  );
}
