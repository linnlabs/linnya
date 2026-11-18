import type { PluginInferencePort } from '@plugin/backend/inferenceRuntime';
import type { KnowledgeExecution } from '../definitions/knowledgeExecution';

/** CLI 返回前等待自己的 Worker settled、图谱后继和重试；不 drain 同库的其他操作。 */
export function createKnowledgeExecution(
  inference: PluginInferencePort,
  parentSignal: AbortSignal
): KnowledgeExecution {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const pending = new Set<Promise<void>>();
  let failure: unknown;
  async function settle() {
    // 一个已跟踪回调可能继续接纳后继 job，直到所有层级真实收口才返回。
    while (pending.size) await Promise.all([...pending]);
  }
  return {
    inference,
    signal,
    track(operation) {
      const completion = operation
        .then(
          () => undefined,
          error => {
            failure ??= error;
          }
        )
        .finally(() => pending.delete(completion));
      pending.add(completion);
      return operation;
    },
    async wait() {
      await settle();
      signal.throwIfAborted();
      if (failure !== undefined) throw failure;
    },
    async close() {
      controller.abort(new Error('知识库 CLI 执行结束'));
      await settle();
    },
  };
}
