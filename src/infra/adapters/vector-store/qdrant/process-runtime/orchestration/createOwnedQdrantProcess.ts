import type { Writable } from 'node:stream';
import { createInterface } from 'node:readline';

import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcessLaunch,
  OwnedProcessResourceReleaseResult,
  OwnedProcessTreeStopResult,
} from '../../../../../../shared/process-runtime';
import {
  QdrantProcessCleanupError,
  type OwnedQdrantProcess,
} from '../definitions/ownedQdrantProcess';

/**
 * Qdrant 的长生命周期只在这里接触公共 OS process owner。向量库管理器负责配置和
 * readyz，本层只负责输出排空、整树归零与资源释放，不能把 kill-request 当成 terminal。
 */
export async function createOwnedQdrantProcess(input: {
  readonly launchOwnedPipeProcess: LaunchOwnedPipeProcess;
  readonly launch: OwnedPipeProcessLaunch;
  readonly output: Writable;
}): Promise<OwnedQdrantProcess> {
  let outputFailure: Error | undefined;
  const recordOutputFailure = (error: Error): void => {
    outputFailure ??= error;
  };
  input.output.once('error', recordOutputFailure);

  let owner;
  try {
    owner = await input.launchOwnedPipeProcess(input.launch);
  } catch (error: unknown) {
    await endOutput(input.output);
    throw error;
  }

  // Qdrant 的“HTTP listening on 0”打印的是配置值；Actix 的 listening on 才是
  // 已绑定 socket 的实际地址。协议由锁定的 runtime 制品与真实并行 E2E 共同约束。
  const lines = [owner.stdout, owner.stderr].map(stream => createInterface({ input: stream }));
  const listening = new Promise<number>(resolve => {
    for (const reader of lines) {
      reader.on('line', line => {
        const match = /actix_server::server: starting service: .*listening on: 127\.0\.0\.1:(\d+)/u.exec(line);
        if (match) resolve(Number(match[1]));
      });
    }
  });
  const httpPort = Promise.race([
    listening,
    owner.rootExit.then(exit => {
      throw new Error(`Qdrant 在报告 HTTP listener 前退出: ${exit.exitCode ?? exit.signal}`);
    }),
  ]);
  // consumer 在取得 owner 后才等待端口；提前退出仍由该 promise 正式传播。
  void httpPort.catch(() => {});

  const stopAfterOutputFailure = (error: Error): void => {
    recordOutputFailure(error);
    void owner.stopAndWaitForTreeEmpty();
  };
  owner.stdout.once('error', stopAfterOutputFailure);
  owner.stderr.once('error', stopAfterOutputFailure);
  input.output.once('error', () => {
    void owner.stopAndWaitForTreeEmpty();
  });
  owner.stdout.pipe(input.output, { end: false });
  owner.stderr.pipe(input.output, { end: false });

  const terminal = (async () => {
    let rootFailure: unknown;
    let rootExit;
    try {
      rootExit = await owner.rootExit;
    } catch (error: unknown) {
      rootFailure = error;
    }
    const treeCleanup = rootFailure
      ? await owner.stopAndWaitForTreeEmpty()
      : await owner.treeEmpty;
    const resourceRelease = await owner.release();
    await endOutput(input.output);
    for (const reader of lines) reader.close();
    assertCleanupSucceeded(treeCleanup, resourceRelease);
    if (rootFailure) throw rootFailure;
    if (outputFailure) throw outputFailure;
    if (!rootExit) throw new Error('Qdrant root exit fact is unavailable');
    return rootExit;
  })();

  let stopSettlement: Promise<void> | undefined;
  return Object.freeze({
    httpPort,
    terminal,
    stopAndWait(): Promise<void> {
      stopSettlement ??= (async () => {
        const treeCleanup = await owner.stopAndWaitForTreeEmpty();
        const resourceRelease = await owner.release();
        assertCleanupSucceeded(treeCleanup, resourceRelease);
        await terminal;
      })();
      return stopSettlement;
    },
  });
}

function assertCleanupSucceeded(
  treeCleanup: OwnedProcessTreeStopResult,
  resourceRelease: OwnedProcessResourceReleaseResult,
): void {
  if (treeCleanup.status === 'failed' || resourceRelease.status === 'failed') {
    throw new QdrantProcessCleanupError(treeCleanup, resourceRelease);
  }
}

async function endOutput(output: Writable): Promise<void> {
  if (output.destroyed || output.writableFinished) return;
  await new Promise<void>(resolve => output.end(resolve));
}
