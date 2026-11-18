import type {
  PluginWorkerJob,
  PluginWorkerQueue,
  PluginWorkerQueueOptions,
  PluginWorkerQueueObserver,
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
import { Logger } from 'src/shared/logger';

interface PluginWorkerQueueHost {
  readonly bootstrapScriptPath: string;
  readonly database: WorkerHostData['database'];
  readonly inference: PluginInferencePort;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** 插件只拥有 job 和订阅；线程、冻结连接身份及推理实现仍由 Host 持有。 */
export function createHostPluginWorkerQueue<T extends object>(
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
  const removeExecutionAbort = new Map<string, () => void>();
  const logger = new Logger('PluginWorkerQueue');
  const observers = new Set<PluginWorkerQueueObserver>();
  const queue = new WorkerThreadQueue<T>({
    workerScript: host.bootstrapScriptPath,
    maxConcurrency: options.maxConcurrency,
    workerEnvironment: freezePluginWorkerEnvironment(host.environment),
    lifecycleObserver: {
      onProgress({ job, data }) {
        for (const observer of observers) {
          observer.progress?.({ jobId: job.id, progress: job.progress, data });
        }
      },
      onCompleted({ job, result }) {
        for (const observer of observers) observer.completed?.({ jobId: job.id, result });
      },
    },
    hostData: { database: host.database, pluginRuntime: { artifactDirectory: pluginDirectory, entryPath: workerEntry } },
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
  queue.on('taskFailed', (job: WorkerJob<T> & { readonly error: string }) => {
    for (const observer of observers) observer.failed?.({ jobId: job.id, error: job.error });
  });
  queue.on('taskSettled', (jobId: string) => {
    handlers.delete(jobId);
    removeExecutionAbort.get(jobId)?.();
    removeExecutionAbort.delete(jobId);
    for (const observer of observers) observer.settled?.(jobId);
  });
  let closing: Promise<void> | undefined;

  function snapshot(job: WorkerJob<T>): PluginWorkerJob<T> {
    // 对外查询不能改写正在运行的 job，也不能改写等待启动任务的模型快照。
    return structuredClone(job);
  }

  return {
    async addJob(jobId, data, execution) {
      if (closing) throw new Error('插件 Worker 队列正在关闭');
      assertEnabled();
      if (getRegisteredBackendPluginDirectory(options.pluginId) !== pluginDirectory) {
        throw new Error('插件 artifact 已变更，旧队列不能接收新任务');
      }
      if (queue.getTask(jobId)) throw new Error(`Worker jobId 已存在: ${jobId}`);
      execution?.signal.throwIfAborted();
      const frozenData = structuredClone(data);
      if (options.inferenceAdmission) {
        const admission = structuredClone(options.inferenceAdmission(frozenData));
        handlers.set(
          jobId,
          createInferenceWorkerRequestHandler(execution?.inference ?? host.inference, {
            allowedOperations: new Set(admission.operations),
            modelIds: new Set(admission.modelIds),
            inputFiles: admission.inputFiles,
            temporaryDirectory: admission.temporaryDirectory,
          })
        );
      }
      if (execution) {
        const cancel = () => {
          void queue.cancelTask(jobId).catch(error => logger.error('父执行取消 Worker 失败', { jobId, error }));
        };
        execution.signal.addEventListener('abort', cancel, { once: true });
        removeExecutionAbort.set(jobId, () => execution.signal.removeEventListener('abort', cancel));
      }
      try {
        execution?.signal.throwIfAborted();
        const id = await queue.addJob(jobId, frozenData);
        if (execution?.signal.aborted) await queue.cancelTask(id);
        return id;
      } catch (error) {
        handlers.delete(jobId);
        removeExecutionAbort.get(jobId)?.();
        removeExecutionAbort.delete(jobId);
        throw error;
      }
    },
    getJob(jobId) {
      const job = queue.getTask(jobId);
      return job ? snapshot(job) : undefined;
    },
    listJobs() {
      return queue.listTasks().map(snapshot);
    },
    cancelJob(jobId) {
      return queue.cancelTask(jobId);
    },
    shutdown() {
      closing ??= queue.shutdown().finally(() => {
        handlers.clear();
        for (const remove of removeExecutionAbort.values()) remove();
        removeExecutionAbort.clear();
      });
      return closing;
    },
    subscribe(observer) {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
  };
}
