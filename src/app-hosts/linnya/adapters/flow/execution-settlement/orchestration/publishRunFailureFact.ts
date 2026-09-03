import { graph } from 'linnkit/runtime-kernel';
import type { CreateRunFailureEventInput } from '../functions/createRunFailureEvent';
import { createRunFailureEvent } from '../functions/createRunFailureEvent';

/** Graph 尚未发布终态错误时，由 AgentRunner 创建并发布唯一的 run failure 事实。 */
export function publishRunFailureFact(
  input: CreateRunFailureEventInput,
  runtimeEventSink: graph.RuntimeEventSink,
): graph.RuntimeFailureFact {
  const published = runtimeEventSink(createRunFailureEvent(input), 'AgentRunner.runError');
  if (!graph.isRuntimeFailureFact(published)) {
    throw new Error('Run failure did not publish a classified Runtime error fact.');
  }
  return published;
}
