import type { Writable } from 'node:stream';

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
    assertCleanupSucceeded(treeCleanup, resourceRelease);
    if (rootFailure) throw rootFailure;
    if (outputFailure) throw outputFailure;
    if (!rootExit) throw new Error('Qdrant root exit fact is unavailable');
    return rootExit;
  })();

  let stopSettlement: Promise<void> | undefined;
  return Object.freeze({
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
