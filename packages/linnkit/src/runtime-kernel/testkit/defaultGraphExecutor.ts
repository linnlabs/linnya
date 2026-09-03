import { GraphExecutor } from '../graph-engine/engine';
import { MemoryCheckpointer } from '../graph-engine/checkpointer/memoryCheckpointer';
import type { Checkpointer } from '../graph-engine/checkpointer/base';
import { ToolNode } from '../graph-engine/nodes/toolNode';
import { UserNode } from '../graph-engine/nodes/userNode';
import { WaitUserNode } from '../graph-engine/nodes/waitUserNode';
import type { GraphNode } from '../graph-engine/types';
import type {
  ObservationPreviewPort,
  ToolModelInputCapabilityValidatorPort,
  ToolModelInputResolverPort,
  ToolRuntimePort,
} from '../tools';
import type { AuditPort } from '../../ports';
import type { TelemetryPort } from '../telemetry/telemetryPort';

export interface DefaultGraphExecutorOptions {
  llmNode: GraphNode;
  toolRuntime: ToolRuntimePort;
  observationPreview: ObservationPreviewPort;
  maxSteps?: number;
  checkpointer?: Checkpointer;
  auditPort?: AuditPort;
  telemetryPort?: TelemetryPort;
  modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
  modelInputResolver?: ToolModelInputResolverPort;
}

export function createDefaultGraphExecutor(
  options: DefaultGraphExecutorOptions,
): GraphExecutor {
  const executor = new GraphExecutor(
    options.checkpointer ?? new MemoryCheckpointer(),
    { maxSteps: options.maxSteps ?? 8 },
  );
  executor.registerNode(new UserNode());
  executor.registerNode(options.llmNode);
  executor.registerNode(new ToolNode({
    toolRuntime: options.toolRuntime,
    observationPreview: options.observationPreview,
    auditPort: options.auditPort,
    telemetryPort: options.telemetryPort,
    modelInputCapabilityValidator: options.modelInputCapabilityValidator,
    modelInputResolver: options.modelInputResolver,
  }));
  executor.registerNode(new WaitUserNode({ auditPort: options.auditPort }));
  return executor;
}
