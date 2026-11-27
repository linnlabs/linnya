import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../electron-main/services/apiServer', () => ({
  ApiServer: class TestApiServer {
    setupMiddleware(): void {}
    async start(port: number): Promise<number> {
      return port;
    }
    async stop(): Promise<void> {}
    getToken(): string {
      return 'test-token';
    }
  },
}));

vi.mock('../../../../electron-main/services/serviceInitializer', () => ({
  ServiceInitializer: class TestServiceInitializer {
    async stopStartupMaintenance(): Promise<void> {}
    async initializeServices(): Promise<never> {
      throw new Error('initializeServices test implementation is required');
    }
  },
}));

let pluginDataRoot = '';
vi.mock('../../plugin-registry/pluginDataRoot', () => ({
  resolveRegisteredPluginDataRoot: () => pluginDataRoot,
}));

import { createRegisteredPluginVectorRuntime } from '../../plugin-registry/pluginVectorRuntimeFactory';
import { QueueManager } from '../../../../infra/task-queue/queues';
import {
  ServiceInitializer,
  type InitializedServices,
} from '../../../../electron-main/services/serviceInitializer';
import type { QdrantProcessRuntime } from '../../../../infra/adapters/vector-store/qdrant';
import { BackendRuntimeOwner } from './backendRuntimeOwner';

const BACKEND_CONFIGURATION = Object.freeze({
  qdrant: Object.freeze({ host: '127.0.0.1', port: 6333 }),
  server: Object.freeze({ port: 34000 }),
});

let root: string;
let binaryPath: string;
const launch = vi.fn(async (): Promise<never> => {
  throw new Error('fixture launcher reached');
});

function initializedServices(): InitializedServices {
  return {
    capabilityFailures: [],
    get transcriptionService(): never {
      throw new Error('unused transcription');
    },
    get databaseService(): never {
      throw new Error('unused database');
    },
    get documentOcr(): never {
      throw new Error('unused OCR');
    },
  };
}

/** 让 `<数据根>/qdrant` 恰好为指定长度，即实际传给 Qdrant 的工作目录。 */
function useQdrantDirectoryOfLength(length: number): string {
  const padding = length - root.length - path.sep.length * 2 - 'qdrant'.length;
  if (padding < 1) throw new Error(`临时目录太长，无法构造 ${length} 字符的数据目录`);
  pluginDataRoot = path.join(root, 'd'.repeat(padding));
  const qdrantDirectory = path.join(pluginDataRoot, 'qdrant');
  expect(qdrantDirectory).toHaveLength(length);
  return qdrantDirectory;
}

async function startOwner(platform: QdrantProcessRuntime['platform']): Promise<BackendRuntimeOwner> {
  vi.spyOn(ServiceInitializer.prototype, 'initializeServices').mockResolvedValue(initializedServices());
  const owner = new BackendRuntimeOwner(
    { binaryPath, platform, environment: Object.freeze({}) },
    launch,
    Object.freeze({
      audioProcessingScriptPath: '/test/runtime/audio-processing.worker.cjs',
      pluginBootstrapScriptPath: '/test/runtime/plugin-runtime.worker.cjs',
    }),
    Object.freeze({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/workspace/linnya/_dev_data',
      workspaceRoot: '/workspace/linnya/_dev_data',
      workspaceRootIsCustom: false,
    }),
    '0.0.38',
  );
  await owner.start(BACKEND_CONFIGURATION);
  return owner;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(() => true, () => false);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'qdrant-dir-'));
  binaryPath = path.join(root, 'qdrant');
  await writeFile(binaryPath, 'fixture binary');
  launch.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function stopOwner(owner: BackendRuntimeOwner): Promise<void> {
  vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
  await owner.stop();
}

describe('Windows 上 Qdrant 数据目录长度', () => {
  it('超过 100 字符：不启动 Qdrant、不建任何目录，向插件报出“目录太长”且本次保持该状态', async () => {
    const qdrantDirectory = useQdrantDirectoryOfLength(101);
    const owner = await startOwner('win32');
    const vectorStore = createRegisteredPluginVectorRuntime('knowledge');
    const expected = { name: 'QdrantRuntimeUnavailableError', reason: 'data-directory-too-long' };
    await expect(vectorStore.ensureReady()).rejects.toMatchObject(expected);
    await expect(vectorStore.ensureReady()).rejects.toMatchObject(expected);
    expect(launch).not.toHaveBeenCalled();
    expect(await exists(qdrantDirectory)).toBe(false);
    await vectorStore.stop();
    await stopOwner(owner);
  });

  it('恰好 100 字符：照常写配置并拉起进程', async () => {
    const qdrantDirectory = useQdrantDirectoryOfLength(100);
    const owner = await startOwner('win32');
    const vectorStore = createRegisteredPluginVectorRuntime('knowledge');
    // 夹具启动器在拉起进程处失败，说明已越过长度检查；这类失败仍归为一般启动故障。
    await expect(vectorStore.ensureReady()).rejects.toMatchObject({ reason: 'startup-failed' });
    expect(launch).toHaveBeenCalledOnce();
    expect(await exists(path.join(qdrantDirectory, 'config', 'config.yaml'))).toBe(true);
    await vectorStore.stop();
    await stopOwner(owner);
  });

  it('macOS 不受这个上限约束', async () => {
    useQdrantDirectoryOfLength(101);
    const owner = await startOwner('darwin');
    const vectorStore = createRegisteredPluginVectorRuntime('knowledge');
    await expect(vectorStore.ensureReady()).rejects.toMatchObject({ reason: 'startup-failed' });
    expect(launch).toHaveBeenCalledOnce();
    await vectorStore.stop();
    await stopOwner(owner);
  });
});
