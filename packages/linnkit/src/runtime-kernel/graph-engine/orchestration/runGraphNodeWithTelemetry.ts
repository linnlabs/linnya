import type { TelemetryPort } from '../../telemetry/telemetryPort';
import { buildRuntimeTelemetryScope, resolveRuntimeRunId } from '../functions/graphTelemetryScope';
import type { EngineState, GraphNode, NodeResult } from '../types';
import { RunIdSchema } from '../../../contracts';

export interface RunGraphNodeWithTelemetryInput {
  node: GraphNode;
  state: EngineState;
  checkpointKey: string;
  telemetryPort: TelemetryPort;
  now?: () => number;
}

export async function runGraphNodeWithTelemetry(
  input: RunGraphNodeWithTelemetryInput
): Promise<NodeResult> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const nodeId = input.state.nodeId;
  const runId = resolveRuntimeRunId({
    state: input.state,
    fallbackRunId: RunIdSchema.parse(input.checkpointKey),
  });
  const scope = buildRuntimeTelemetryScope({ state: input.state, runId });

  try {
    return await input.node.run(input.state);
  } finally {
    input.telemetryPort.emit({
      kind: 'graph_node',
      nodeId,
      durationMs: now() - startedAt,
      scope,
    });
  }
}
