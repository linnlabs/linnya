import { EventBus, EventSequencer, RuntimeEventPublisher } from '../../../execution';
import type { RuntimeEventSink } from '../../types';
import { RunIdSchema } from '../../../../contracts';

/**
 * 为节点测试装配与生产执行相同的 RuntimeEvent admission 边界。
 *
 * 测试只依赖 Graph 的窄 port；run 身份附着、execution 序列和 EventBus fan-out
 * 仍由正式 publisher 完成，避免测试重新发明一套简化路由语义。
 */
export function createRuntimeEventAdmissionSink(
  conversationId = 'conversation-tool-node-test',
  runId = 'run-tool-node-test'
): RuntimeEventSink {
  const sequencer = new EventSequencer(conversationId);
  const eventBus = new EventBus(sequencer.getExecutionId());
  const publisher = new RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse(runId),
    lane: 'foreground',
    visibility: 'conversation',
  });

  return (event, source) => publisher.publish(event, source);
}
