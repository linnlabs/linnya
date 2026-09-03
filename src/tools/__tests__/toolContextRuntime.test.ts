import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../types';
import {
  ensureToolContextRuntimeCapability,
  getToolContextRuntimeBinding,
  readToolContextPersistedHistory,
  readToolContextWorkingHistory,
  stripRuntimeReservedToolContextPatch,
} from '@linnlabs/linnkit/runtime-kernel';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { createToolOutputEvent, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

function makeEvent(id: string): RuntimeEvent {
  return createToolOutputEvent(
    id,
    'conv_1',
    'turn_1',
    'knowledge_search',
    `call_${id}`,
    { status: 'success', observation: 'search complete', data: {} }
  );
}

describe('toolContextRuntime', () => {
  it('conversationView 应明确区分 working 与 persisted history', () => {
    const persistedHistory = [makeEvent('persisted_contract_1')];
    const workingHistory = [makeEvent('working_contract_1')];
    const context: ToolContext = {};

    ensureToolContextRuntimeCapability({
      context,
      persistedHistory,
      workingHistory,
    });

    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(workingHistory);
    expect(context.conversationView?.getPersistedHistoryEvents()).toBe(persistedHistory);
  });

  it('应提供稳定 capability，并允许后续切换 working history source', () => {
    const persistedHistory = [makeEvent('persisted_1')];
    const initialWorkingHistory = [makeEvent('working_1')];
    const nextWorkingHistory = [makeEvent('working_2')];
    const context: ToolContext = {};

    const binding = ensureToolContextRuntimeCapability({
      context,
      persistedHistory,
      workingHistory: initialWorkingHistory,
      executionMeta: {
        conversationId: 'conv_1',
        turnId: 'turn_1',
      },
    });

    expect(context.conversationView?.getPersistedHistoryEvents()).toBe(persistedHistory);
    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(initialWorkingHistory);
    expect(context.conversationId).toBe('conv_1');
    expect(context.turnId).toBe('turn_1');

    binding.setWorkingHistorySource(nextWorkingHistory);
    binding.bindExecutionMeta({
      parentToolCallId: ToolCallIdSchema.parse('call_2'),
    });

    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(nextWorkingHistory);
    expect(context.parentToolCallId).toBe('call_2');
    expect(getToolContextRuntimeBinding(context)).toBe(binding);
  });

  it('再次 ensure 时应复用同一个 binding', () => {
    const context: ToolContext = {};
    const nextWorkingHistory = [makeEvent('working_2')];
    const first = ensureToolContextRuntimeCapability({
      context,
      persistedHistory: [],
      workingHistory: [],
    });

    const second = ensureToolContextRuntimeCapability({
      context,
      workingHistory: nextWorkingHistory,
    });

    expect(second).toBe(first);
    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(nextWorkingHistory);
  });

  it('应过滤 runtime reserved patch 字段', () => {
    const patch = stripRuntimeReservedToolContextPatch({
      conversationId: 'conv_override',
      turnId: 'turn_override',
      runId: 'run_override',
      parentRunId: 'parent_run_override',
      parentToolCallId: 'call_override',
      conversationView: { getWorkingHistoryEvents: () => [], getPersistedHistoryEvents: () => [] },
      customValue: 'kept',
    });

    expect(patch).toEqual({
      customValue: 'kept',
    });
  });

  it('history helper 只读取正式 conversationView，缺少 admission 时明确失败', () => {
    const persistedHistory = [makeEvent('persisted_helper_1')];
    const workingHistory = [makeEvent('working_helper_1')];
    const contextWithCapability: ToolContext = {};
    ensureToolContextRuntimeCapability({
      context: contextWithCapability,
      persistedHistory,
      workingHistory,
    });

    expect(readToolContextWorkingHistory(contextWithCapability)).toBe(workingHistory);
    expect(readToolContextPersistedHistory(contextWithCapability)).toBe(persistedHistory);

    expect(() => readToolContextWorkingHistory({})).toThrow(
      'requires an admitted conversationView'
    );
    expect(() => readToolContextPersistedHistory({})).toThrow(
      'requires an admitted conversationView'
    );
  });
});
