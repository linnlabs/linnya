/**
 * orchestrator.ts
 *
 * File-manager 内部的串行编排器（orchestrator）。
 *
 * 中文说明（根因）：
 * - file-manager 存在多个并发入口：activateFileSession / requestSave / deactivateFileSession / auto-save timer；
 * - 若不做串行化，会出现：保存与关闭交错、open 尚未完成就触发保存、离开视图后又触发保存等竞态；
 * - 这里提供一个最小的“单队列串行执行器”，作为 file-manager 的唯一调度器。
 *
 * 约束：
 * - 不做业务逻辑，只负责“按顺序执行异步任务”
 * - 前一个任务失败不会阻断后续任务（避免队列卡死）
 */

export class FileManagerOrchestrator {
    private _tail: Promise<void> = Promise.resolve();

    enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
            try {
                return await task();
            } catch (error) {
                if (isOpenCancellation(error)) {
                    console.debug(`[file-manager/orchestrator] task cancelled: ${label}`, {
                        reason: error.message,
                    });
                } else {
                    console.error(`[file-manager/orchestrator] task failed: ${label}`, error);
                }
                throw error;
            }
        };

        // 无论 tail 成功/失败，都继续串起来，避免“某次失败导致后续永远不执行”
        const current = this._tail.then(run, run);
        this._tail = current.then(
            () => undefined,
            () => undefined
        );
        return current;
    }
}

function isOpenCancellation(error: unknown): boolean {
    return error instanceof Error && error.name === 'FileSessionOpenCancelledError';
}
