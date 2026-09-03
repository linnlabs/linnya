import { describe, expect, it } from 'vitest';

import type { AgentSpec } from '../../../../contracts';
import { EventBus } from '../../../execution/event-bus';
import { MemoryEventStore } from '../../../graph-engine/event-store/memoryEventStore';
import type { RunCostCollector, RunRequestSnapshot } from '../../runHandle';
import { createInitialRunRecord, forwardParentAbortSignal } from '../runRegistration';
import { RunIdSchema } from '../../../../contracts';

const agentSpec: AgentSpec = {
  id: 'agent-1',
  version: '1.0.0',
  capabilities: ['chat'],
  tools: [],
  contextPolicy: { profileId: 'agent' },
};

const request = {
  query: 'hello',
  promptKey: 'default',
} satisfies RunRequestSnapshot;

const costCollector: RunCostCollector = {
  snapshot: () => ({ tokensInput: 1, tokensOutput: 2 }),
};

function createSpec() {
  return {
    conversationId: 'conv-1',
    parentRunId: RunIdSchema.parse('parent-1'),
    agentSpec,
    request,
    eventBus: new EventBus('exec-1'),
    eventStore: new MemoryEventStore(),
    costCollector,
    iterationBudget: { max: 5, refundable: true },
    metadata: {
      nested: {
        value: 'original',
      },
    },
  };
}

describe('runRegistration', () => {
  it('createInitialRunRecord 投影注册输入并克隆 metadata', () => {
    const spec = createSpec();
    const record = createInitialRunRecord({
      runId: RunIdSchema.parse('run-1'),
      spec,
      startedAt: 10,
    });

    expect(record).toMatchObject({
      runId: 'run-1',
      conversationId: 'conv-1',
      parentRunId: 'parent-1',
      agentSpecId: 'agent-1',
      status: 'pending',
      startedAt: 10,
      updatedAt: 10,
      iterationBudget: { max: 5, refundable: true },
      metadata: {
        nested: {
          value: 'original',
        },
      },
    });
    expect(record.metadata).not.toBe(spec.metadata);
  });

  it('forwardParentAbortSignal 连接父 signal 的当前与未来取消', () => {
    const alreadyAbortedParent = new AbortController();
    alreadyAbortedParent.abort('parent already aborted');
    const alreadyAbortedChild = new AbortController();

    forwardParentAbortSignal(alreadyAbortedChild, alreadyAbortedParent.signal);
    expect(alreadyAbortedChild.signal.aborted).toBe(true);
    expect(alreadyAbortedChild.signal.reason).toBe('parent already aborted');

    const parent = new AbortController();
    const child = new AbortController();
    forwardParentAbortSignal(child, parent.signal);

    parent.abort('parent aborted later');
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBe('parent aborted later');
  });
});
