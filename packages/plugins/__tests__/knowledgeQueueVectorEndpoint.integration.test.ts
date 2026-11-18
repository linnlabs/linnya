import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import * as databaseModule from 'src/electron-main/services/database';
import * as inferenceModule from 'src/plugin-sdk/backend/inferenceRuntime';
import { installPluginWorkerRuntime } from 'src/app-hosts/linnya/adapters/plugin-worker-queue/ports/pluginWorkerRuntime';
import { registeredBackendPluginDirectories } from 'src/app-hosts/linnya/plugin-registry/registeredPluginDirectories';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { KnowledgeQueues } from '../knowledge/src/backend/queue/orchestration/KnowledgeQueues';
import { createKnowledgeActivityOwner } from '../knowledge/src/backend/runtime/orchestration/createKnowledgeActivityOwner';

// 本组不执行模型；任何意外推理都让测试失败，而不是请求外部服务。
const inference: PluginInferencePort = {
  embedding: {
    embed: async () => {
      throw new Error('unexpected embedding');
    },
  },
  textGeneration: {
    generate: async () => {
      throw new Error('unexpected text inference');
    },
  },
  reranking: {
    rerank: async () => {
      throw new Error('unexpected reranking');
    },
  },
  documentOcr: {
    resolveModelProfile: async () => {
      throw new Error('unexpected OCR profile');
    },
    recognizeDocument: async () => {
      throw new Error('unexpected OCR');
    },
  },
};

describe('知识库插件向量 Worker 的实例归属', () => {
  it('实际插件队列经正式 SDK 向真实 Worker 冻结 owner 地址，并拒绝缺失地址', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-knowledge-endpoint-'));
    const artifact = path.join(root, 'artifact');
    const workers = path.join(artifact, 'dist/backend/workers');
    await mkdir(workers, { recursive: true });
    const cache = path.resolve('node_modules/.cache');
    await mkdir(cache, { recursive: true });
    const host = await mkdtemp(path.join(cache, 'knowledge-endpoint-host-'));
    const bootstrap = path.join(host, 'plugin-runtime.worker.cjs');
    await build({
      entryPoints: [path.resolve('src/infra/task-queue/workers/plugin-runtime.worker.ts')],
      outfile: bootstrap,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'silent',
    });
    for (const name of ['knowledgeIngestion', 'graphExtraction', 'graphIndexing']) {
      await writeFile(
        path.join(workers, `${name}.worker.cjs`),
        `
        const { parentPort, workerData } = require('node:worker_threads');
        parentPort.postMessage({ type: 'completed', result: workerData.runtime });
      `
      );
    }
    const database = new databaseModule.DatabaseService(path.join(root, 'workspace.sqlite'));
    database.initialize();
    vi.spyOn(databaseModule, 'getDatabaseService').mockReturnValue(database);
    vi.spyOn(inferenceModule, 'getPluginInferencePort').mockReturnValue(inference);
    registeredBackendPluginDirectories.set('knowledge', artifact);
    setPluginRuntimeStateForTests({ enabledPluginIds: ['knowledge'] });
    const disposeRuntime = installPluginWorkerRuntime(bootstrap);
    const activity = createKnowledgeActivityOwner();
    const resolveVectorUrl = vi.fn(async () => 'http://127.0.0.1:49200');
    const queue = new KnowledgeQueues({
      activity,
      resolveVectorUrl,
      paths: {
        sotDirectory: path.join(root, 'sources'),
        originalsDirectory: path.join(root, 'originals'),
        temporaryDirectory: path.join(root, 'jobs'),
      },
    });
    const completed = (name: 'ingestion' | 'graphIndexing') =>
      new Promise<unknown>((resolve, reject) => {
        queue.once(`${name}:taskCompleted`, event => resolve(event.result));
        queue.once(`${name}:taskFailed`, event => reject(new Error(event.error)));
      });
    try {
      const ingestion = completed('ingestion');
      const graph = completed('graphIndexing');
      const payload = {
        taskId: 'ingestion',
        kbId: 'kb',
        docId: 'doc',
        embeddingModelId: 'embedding',
        filename: 'doc.txt',
        filePath: path.join(root, 'doc.txt'),
        priority: 5,
        retry: false,
        forceVisionMode: false,
        // 旧调用者携带其他实例的 runtime 不能覆盖本次 activation 的真实地址和素材目录。
        runtime: { qdrantUrl: 'http://127.0.0.1:6333', temporaryDirectory: '/unowned' },
      };
      await queue.addIngestionTask(payload);
      await queue.addGraphIndexingTask({ ...payload, taskId: 'graph' });
      expect(await ingestion).toMatchObject({
        qdrantUrl: 'http://127.0.0.1:49200',
        temporaryDirectory: path.join(root, 'jobs/ingestion'),
      });
      expect(await graph).toMatchObject({
        qdrantUrl: 'http://127.0.0.1:49200',
        temporaryDirectory: path.join(root, 'jobs/graph'),
      });
      await vi.waitFor(() => expect(activity.hasActivity()).toBe(false));
      resolveVectorUrl.mockRejectedValueOnce(new Error('vector owner unavailable'));
      await expect(queue.addIngestionTask({ ...payload, taskId: 'rejected' })).rejects.toThrow(
        'vector owner unavailable'
      );
      expect(queue.getTaskById('rejected')).toBeUndefined();
      expect(activity.hasActivity()).toBe(false);
      await queue.shutdown();
      await expect(queue.addIngestionTask({ ...payload, taskId: 'after-close' })).rejects.toThrow(
        '停用'
      );
    } finally {
      await queue.shutdown();
      await activity.drain();
      disposeRuntime();
      registeredBackendPluginDirectories.delete('knowledge');
      clearPluginRuntimeStateForTests();
      vi.restoreAllMocks();
      database.close();
      await rm(root, { recursive: true, force: true });
      await rm(host, { recursive: true, force: true });
    }
  });
});
