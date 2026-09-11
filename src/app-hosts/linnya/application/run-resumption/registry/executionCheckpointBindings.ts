import type { graph } from '@linnlabs/linnkit/runtime-kernel';
import type { RunId } from '@linnlabs/linnkit/contracts';

/** Graph 只持有这个窄 port；每次 execution 绑定自己的 EventBus 提交队列。 */
export class ExecutionCheckpointBindings implements graph.ExecutionCheckpointPort {
  private readonly writers = new Map<string, graph.ExecutionCheckpointPort>();

  bind(runId: RunId, writer: graph.ExecutionCheckpointPort): () => void {
    if (this.writers.has(runId)) throw new Error(`Execution still settling for run ${runId}`);
    this.writers.set(runId, writer);
    return () => {
      if (this.writers.get(runId) === writer) this.writers.delete(runId);
    };
  }

  async commit(checkpointKey: string, checkpoint: graph.EngineState): Promise<void> {
    const writer = this.writers.get(checkpointKey);
    if (!writer) throw new Error(`No execution checkpoint binding for ${checkpointKey}`);
    await writer.commit(checkpointKey, checkpoint);
  }
}
