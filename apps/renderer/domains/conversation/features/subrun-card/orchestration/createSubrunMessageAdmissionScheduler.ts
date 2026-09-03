import type { SubrunTraceBucket } from '../../subrun-trace';
import {
  createSubrunMessageProjectionAdmission,
  type SubrunMessageProjectionSnapshot,
} from '../functions/admitSubrunMessageProjection';

export interface SubrunMessageAdmissionScheduler {
  request(bucket: SubrunTraceBucket | null): void;
  dispose(): void;
}

/**
 * Vue reactive callback 只能把 canonical snapshot 交给这里；真正的 strict admission 与
 * presentation projector 在 reactive flush 结束后的微任务运行，错误通过显式端口返回。
 */
export function createSubrunMessageAdmissionScheduler(params: {
  readonly onCommit: (snapshot: SubrunMessageProjectionSnapshot) => void;
  readonly onError: (error: Error) => void;
}): SubrunMessageAdmissionScheduler {
  const admission = createSubrunMessageProjectionAdmission();
  let requestedBucket: SubrunTraceBucket | null = null;
  let scheduled = false;
  let disposed = false;

  const flush = (): void => {
    scheduled = false;
    if (disposed) return;
    try {
      params.onCommit(admission.admit(requestedBucket));
    } catch (caught) {
      params.onError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  };

  return {
    request(bucket) {
      if (disposed) return;
      requestedBucket = bucket;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    },
    dispose() {
      disposed = true;
      requestedBucket = null;
    },
  };
}
