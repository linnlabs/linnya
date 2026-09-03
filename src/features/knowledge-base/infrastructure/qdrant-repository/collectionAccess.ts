/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/collectionAccess.ts
 *
 * @brief collection 级访问协调器
 *
 * 说明：
 * - 普通搜索 / 上传 / 删除走 shared access；
 * - 启动维护 / recreate 走 exclusive access；
 * - 这样平时不会把所有搜索串行化，但能保证后台重建期间同 collection 不发生并发踩踏。
 */

import type { QdrantRepository } from '../qdrantRepository';

export type CollectionAccessMode = 'shared' | 'exclusive';

type ReleaseFn = () => void;

type PendingRequest = {
  mode: CollectionAccessMode;
  resolve: (release: ReleaseFn) => void;
};

type CollectionAccessState = {
  activeSharedCount: number;
  activeExclusive: boolean;
  queue: PendingRequest[];
};

const collectionAccessStates = new Map<string, CollectionAccessState>();

function getOrCreateState(collectionName: string): CollectionAccessState {
  const existing = collectionAccessStates.get(collectionName);
  if (existing) {
    return existing;
  }

  const created: CollectionAccessState = {
    activeSharedCount: 0,
    activeExclusive: false,
    queue: [],
  };
  collectionAccessStates.set(collectionName, created);
  return created;
}

function tryCleanupState(collectionName: string, state: CollectionAccessState): void {
  if (state.activeSharedCount === 0 && !state.activeExclusive && state.queue.length === 0) {
    collectionAccessStates.delete(collectionName);
  }
}

function drainQueue(collectionName: string, state: CollectionAccessState): void {
  if (state.activeExclusive || state.activeSharedCount > 0 || state.queue.length === 0) {
    return;
  }

  const first = state.queue[0];
  if (first.mode === 'exclusive') {
    const request = state.queue.shift();
    if (!request) {
      return;
    }

    state.activeExclusive = true;
    request.resolve(() => {
      state.activeExclusive = false;
      drainQueue(collectionName, state);
      tryCleanupState(collectionName, state);
    });
    return;
  }

  while (state.queue.length > 0 && state.queue[0]?.mode === 'shared') {
    const request = state.queue.shift();
    if (!request) {
      continue;
    }

    state.activeSharedCount += 1;
    request.resolve(() => {
      state.activeSharedCount -= 1;
      drainQueue(collectionName, state);
      tryCleanupState(collectionName, state);
    });
  }
}

async function acquireCollectionAccess(
  collectionName: string,
  mode: CollectionAccessMode
): Promise<ReleaseFn> {
  const state = getOrCreateState(collectionName);

  if (mode === 'shared' && !state.activeExclusive && state.queue.length === 0) {
    state.activeSharedCount += 1;
    return () => {
      state.activeSharedCount -= 1;
      drainQueue(collectionName, state);
      tryCleanupState(collectionName, state);
    };
  }

  if (mode === 'exclusive' && !state.activeExclusive && state.activeSharedCount === 0 && state.queue.length === 0) {
    state.activeExclusive = true;
    return () => {
      state.activeExclusive = false;
      drainQueue(collectionName, state);
      tryCleanupState(collectionName, state);
    };
  }

  return await new Promise<ReleaseFn>((resolve) => {
    state.queue.push({ mode, resolve });
  });
}

export async function runWithCollectionAccess<T>(
  collectionName: string,
  mode: CollectionAccessMode,
  action: () => Promise<T>
): Promise<T> {
  const release = await acquireCollectionAccess(collectionName, mode);
  try {
    return await action();
  } finally {
    release();
  }
}

export interface CollectionAccessControllableQdrantRepository extends QdrantRepository {
  runWithCollectionAccess<T>(
    collectionName: string,
    mode: CollectionAccessMode,
    action: () => Promise<T>
  ): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasCollectionAccessCoordinator(
  repository: unknown
): repository is CollectionAccessControllableQdrantRepository {
  if (!isRecord(repository)) {
    return false;
  }

  return typeof repository['runWithCollectionAccess'] === 'function';
}
