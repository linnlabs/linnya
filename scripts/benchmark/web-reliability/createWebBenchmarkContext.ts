import type { ToolContext } from '../../../src/tools/types';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../src/domains/citation';
import { createCitationRefAllocatorFixture } from '../../../src/domains/citation/testkit/citationRefAllocatorFixture';
import { decorateWebEvidenceWriterToolContext } from '../../../src/app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator';

/** 每次独立样本只有一次 producer 调用；复用正式分配规则和 Evidence writer，不接入用户对话数据库。 */
export function createWebBenchmarkContext(params: {
  conversationId: string;
  instanceId: string;
  turnId: string;
}): ToolContext {
  const context: ToolContext = {
    conversationId: params.conversationId,
    turnId: params.turnId,
    research: { instanceId: params.instanceId },
  };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  decorateWebEvidenceWriterToolContext(context);
  return context;
}
