import type {
  PluginWorkerJob,
  PluginWorkerQueue,
  PluginWorkerQueueOptions,
  PluginWorkerTask,
} from '@linnya/plugin-host-contract/backend/workerQueue';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import type { WorkerHostRequestHandler } from '@linnya/plugin-host-contract/backend/worker/requests';
import { WorkerThreadQueue, type WorkerJob } from 'src/infra/task-queue/WorkerThreadQueue';
import type { WorkerHostData } from 'src/infra/task-queue/definitions/workerHostData';
import { getRegisteredBackendPluginDirectory } from '../../../plugin-registry/registeredPluginDirectories';
import { assertPluginRuntimeEnabled } from '../../../plugin-registry/pluginRuntimeAccess';
import { createInferenceWorkerRequestHandler } from '../../inference/worker-requests/createInferenceWorkerRequestHandler';
import { freezePluginWorkerEnvironment } from '../functions/freezePluginWorkerEnvironment';
import { resolvePluginWorkerEntry } from '../functions/resolvePluginWorkerEntry';

interface PluginWorkerQueueHost {
  readonly database: WorkerHostData['database'];
  readonly inference: PluginInferencePort;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** 插件只拥有 job 和订阅；线程、冻结连接身份及推理实现仍由 Host 持有。 */
export function createHostPluginWorkerQueue<T extends PluginWorkerTask>(
  options: PluginWorkerQueueOptions<T>,
  host: PluginWorkerQueueHost
): PluginWorkerQueue<T> {
  const pluginDirectory = getRegisteredBackendPluginDirectory(options.pluginId);
  if (!pluginDirectory) throw new Error(`插件没有已准入的 artifact 目录: ${options.pluginId}`);
  const assertEnabled = () =>
    assertPluginRuntimeEnabled({
      pluginId: options.pluginId,
      pluginName: options.pluginId,
      action: '执行后台任务',
    });
  assertEnabled();
  const workerEntry = resolvePluginWorkerEntry(pluginDirectory, options.workerEntry);
  const handlers = new Map<string, WorkerHostRequestHandler>();
  const queue = new WorkerThreadQueue<T>({
    workerScript: workerEntry,
    maxConcurrency: options.maxConcurrency,
    workerEnvironment: freezePluginWorkerEnvironment(host.environment),
    hostData: { database: host.database },
    ...(options.inferenceAdmission
      ? {
          hostRequestHandler(job: Readonly<WorkerJob<T>>) {
            const handler = handlers.get(job.id);
            if (!handler) throw new Error('任务缺少已冻结的推理准入');
            return handler;
          },
        }
      : {}),
  });
  queue.on('taskSettled', (taskId: string) => handlers.delete(taskId));
  let closing: Promise<void> | undefined;

  function snapshot(job: WorkerJob<T>): PluginWorkerJob<T> {
    // 对外查询不能改写正在运行的 job，也不能改写等待启动任务的模型快照。
    return structuredClone(job);
  }

  return {
    async addTask(task) {
      if (closing) throw new Error('插件 Worker 队列正在关闭');
      assertEnabled();
      if (getRegisteredBackendPluginDirectory(options.pluginId) !== pluginDirectory) {
        throw new Error('插件 artifact 已变更，旧队列不能接收新任务');
      }
      if (queue.getTask(task.taskId)) throw new Error(`Worker taskId 已存在: ${task.taskId}`);
      const frozenTask = structuredClone(task);
      if (options.inferenceAdmission) {
        const admission = structuredClone(options.inferenceAdmission(frozenTask));
        handlers.set(
          frozenTask.taskId,
          createInferenceWorkerRequestHandler(host.inference, {
            allowedOperations: new Set(admission.operations),
            modelIds: new Set(admission.modelIds),
            inputFiles: admission.inputFiles,
            temporaryDirectory: admission.temporaryDirectory,
          })
        );
      }
      try {
        return await queue.addTask(frozenTask);
      } catch (error) {
        handlers.delete(frozenTask.taskId);
        throw error;
      }
    },
    getTask(taskId) {
      const job = queue.getTask(taskId);
      return job ? snapshot(job) : undefined;
    },
    listTasks() {
      return queue.listTasks().map(snapshot);
    },
    cancelTask(taskId) {
      return queue.cancelTask(taskId);
    },
    shutdown() {
      closing ??= queue.shutdown().finally(() => handlers.clear());
      return closing;
    },
    subscribe(observer) {
      const progress = (event: { taskId: string; progress: number; data: unknown }) =>
        observer.progress?.(event);
      const completed = (event: { taskId: string; result: unknown }) => observer.completed?.(event);
      const failed = (job: WorkerJob<T> & { readonly error: string }) =>
        observer.failed?.({ taskId: job.id, error: job.error });
      const settled = (taskId: string) => observer.settled?.(taskId);
      queue.on('taskProgress', progress);
      queue.on('taskCompleted', completed);
      queue.on('taskFailed', failed);
      queue.on('taskSettled', settled);
      return () => {
        queue.off('taskProgress', progress);
        queue.off('taskCompleted', completed);
        queue.off('taskFailed', failed);
        queue.off('taskSettled', settled);
      };
    },
  };
}
