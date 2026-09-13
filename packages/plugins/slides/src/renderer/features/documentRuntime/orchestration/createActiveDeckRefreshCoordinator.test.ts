import { describe, expect, it, vi } from 'vitest';
import { createActiveDeckRefreshCoordinator } from './createActiveDeckRefreshCoordinator';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(promiseResolve => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('createActiveDeckRefreshCoordinator', () => {
  it('coalesces the same revision and skips it after the read is loaded', async () => {
    let loadedVersion = 1;
    const deferred = createDeferred();
    const readDocument = vi.fn(async () => {
      await deferred.promise;
      loadedVersion = 2;
    });
    const coordinator = createActiveDeckRefreshCoordinator({
      isActiveDocument: documentId => documentId === 'deck-1',
      hasLoadedRevision: (_, version) => loadedVersion >= version,
      readDocument,
    });

    const first = coordinator.refresh({ documentId: 'deck-1', expectedVersion: 2 });
    const second = coordinator.refresh({ documentId: 'deck-1', expectedVersion: 2 });
    expect(readDocument).toHaveBeenCalledOnce();
    deferred.resolve();
    await Promise.all([first, second]);
    await coordinator.refresh({ documentId: 'deck-1', expectedVersion: 2 });
    expect(readDocument).toHaveBeenCalledOnce();
  });

  it('ignores refreshes once their document is no longer active', async () => {
    let activeDocumentId = 'deck-a';
    const deferred = createDeferred();
    const readDocument = vi.fn(() => deferred.promise);
    const coordinator = createActiveDeckRefreshCoordinator({
      isActiveDocument: documentId => documentId === activeDocumentId,
      hasLoadedRevision: () => false,
      readDocument,
    });

    const stale = coordinator.refresh({ documentId: 'deck-a', expectedVersion: 2 });
    activeDocumentId = 'deck-b';
    deferred.resolve();
    await stale;
    await coordinator.refresh({ documentId: 'deck-a', expectedVersion: 2 });
    expect(readDocument).toHaveBeenCalledOnce();
  });

  it('performs one follow-up read when joined work predates the requested revision', async () => {
    let loadedVersion = 1;
    const oldRead = createDeferred();
    const readDocument = vi.fn()
      .mockImplementationOnce(() => oldRead.promise)
      .mockImplementationOnce(async () => {
        loadedVersion = 2;
      });
    const coordinator = createActiveDeckRefreshCoordinator({
      isActiveDocument: () => true,
      hasLoadedRevision: (_, version) => loadedVersion >= version,
      readDocument,
    });

    const oldRefresh = coordinator.refresh({ documentId: 'deck-1' });
    const revisionRefresh = coordinator.refresh({ documentId: 'deck-1', expectedVersion: 2 });
    oldRead.resolve();
    await Promise.all([oldRefresh, revisionRefresh]);
    expect(readDocument).toHaveBeenCalledTimes(2);
  });
});
