import { describe, expect, it } from 'vitest';
import {
  createHistorySummaryEvent,
  routeRuntimeEvent,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { conversationMessageIdFromToolIdentity } from '@app/schemas';

import {
  uiProjectionFixtures,
  uiProjectionImageAttachments,
} from '../__fixtures__/uiProjectionFixtures';
import { projectEventsWithMemoryApplier } from '../memoryApplier';

function projectFixture(name: string) {
  const fixture = uiProjectionFixtures.find(item => item.name === name);
  if (!fixture) {
    throw new Error(`Missing fixture: ${name}`);
  }
  return projectEventsWithMemoryApplier(fixture.events);
}

describe('conversation UI projection read model', () => {
  it('按 canonical answer identity 隐藏被摘要替换的回答', () => {
    const answer: Extract<RuntimeEvent, { type: 'final_answer' }> = {
      type: 'final_answer',
      id: 'answer-segment',
      conversation_id: 'conversation-summary',
      turn_id: 'turn-summary',
      timestamp: 1,
      version: 1,
      answer_id: 'answer-segment',
      content: '待压缩答案',
      is_complete: true,
      completion_reason: 'terminal',
    };
    const summary = createHistorySummaryEvent(
      'summary-event',
      answer.conversation_id,
      answer.turn_id,
      '历史摘要',
      [answer.id],
      1,
      1,
      { timestamp: 2 },
    );

    const routing = {
      run_id: 'run-summary',
      lane: 'foreground' as const,
      visibility: 'conversation' as const,
    };
    const result = projectEventsWithMemoryApplier([
      routeRuntimeEvent(answer, routing),
      routeRuntimeEvent(summary, routing),
    ]);

    expect(result.rows.find(row => row.messageId === answer.id)?.presentation).toBe('hidden');
    const summaryRow = result.rows.find(row => row.messageId === summary.id);
    if (summaryRow?.messageType !== 'history_summary') throw new Error('Expected summary row');
    expect(summaryRow.payload.summary)
      .toMatchObject({
        replacedMessageIds: [answer.id],
      });
  });

  it('projects a complete turn and attaches execution metrics to the user row', () => {
    const result = projectFixture('single-turn-with-agent-work');

    expect(result.rows.map(row => row.messageType)).toEqual(['user_input', 'thought', 'final_answer']);
    expect(result.rows[0]).toMatchObject({
      messageId: 'evt_user_single',
      role: 'user',
      content: 'hello',
      runId: 'run_single',
    });
    if (result.rows[0]?.messageType !== 'user_input') throw new Error('Expected user row');
    expect(result.rows[0].payload?.agent_work).toEqual({
      duration_ms: 30,
      ended_at: 130,
      outcome: 'completed',
    });
    expect(result.rows[0]?.payload).toMatchObject({
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'quoted text',
          source: { doc_id: 'doc-1' },
        }],
      },
      activity: { runId: 'activity-1', feature: 'projection-parity' },
    });
    expect(result.rows[0]?.presentation).toBe('message');
    expect(result.rows[0]?.payload).not.toHaveProperty('metadata');
    expect(result.rows[0]?.attachments?.map(attachment => ({
      id: attachment.id,
      assetId: attachment.assetId,
    }))).toEqual([
      { id: 'attachment-first', assetId: 'asset-first' },
      { id: 'attachment-second', assetId: 'asset-second' },
    ]);
    expect(result.rows[0]?.attachments).toHaveLength(uiProjectionImageAttachments.length);
    expect(result.rows[1]?.payload).toMatchObject({
      is_complete: true,
      thought_started_at: 105,
      thought_completed_at: 110,
    });
  });

  it('prebuilds secondary rows for batched tool calls and merges later output by tool_call_id', () => {
    const result = projectFixture('batched-tools-with-secondary-output');
    const toolRows = result.rows.filter(row => row.messageType === 'tool_calls');

    expect(toolRows.map(row => row.mergeKey)).toEqual([
      conversationMessageIdFromToolIdentity('run_tools', 'call_search'),
      conversationMessageIdFromToolIdentity('run_tools', 'call_read'),
    ]);
    expect(toolRows[1]).toMatchObject({
      messageId: conversationMessageIdFromToolIdentity('run_tools', 'call_read'),
      content: 'file content',
    });
    expect(toolRows[1]?.payload).toMatchObject({
      tool_call_id: 'call_read',
      tool_name: 'resource_read',
      status: 'success',
      data: 'file content',
      args: { path: '/tmp/a.md' },
    });
    expect(toolRows[1]?.attachments?.map(attachment => attachment.id))
      .toEqual(['attachment-second']);
  });

  it('durable projection 只从 terminal tool data 保存 subrun 身份，不消费实时 trace 帧', () => {
    const result = projectFixture('subrun-summary-attaches-to-parent-tool');
    const toolRow = result.rows.find(row => (
      row.mergeKey === conversationMessageIdFromToolIdentity('run_subrun', 'call_deep')
    ));

    if (toolRow?.messageType !== 'tool_calls') throw new Error('Expected subrun parent tool row');
    expect(toolRow.payload.subrun_summary).toEqual({
      subrun_ids: ['subrun_b', 'subrun_a', 'subrun_c'],
      event_counts: {
        subrun_b: 0,
        subrun_a: 0,
        subrun_c: 0,
      },
    });
  });

  it('projects summary chains uniformly and hides every replaced row', () => {
    const result = projectFixture('summary-chain');

    expect(result.rows.find(row => row.messageId === 'evt_user_old')?.presentation).toBe('hidden');
    expect(result.rows.find(row => row.messageId === 'answer_old')?.presentation).toBe('hidden');

    const summary = result.rows.find(row => row.messageId === 'evt_summary_regular');
    expect(summary).toMatchObject({
      role: 'system',
      messageType: 'history_summary',
      content: 'compressed old discussion',
    });
    if (summary?.messageType !== 'history_summary') throw new Error('Expected history summary row');
    expect(summary.payload.summary).toMatchObject({
      replacedMessageIds: ['evt_user_old', 'answer_old'],
    });

    expect(summary.presentation).toBe('hidden');

    const latestSummary = result.rows.find(row => row.messageId === 'evt_summary_latest');
    expect(latestSummary).toMatchObject({
      role: 'system',
      messageType: 'history_summary',
      content: 'latest compressed summary',
    });
    if (latestSummary?.messageType !== 'history_summary') throw new Error('Expected latest history summary row');
    expect(latestSummary.payload.summary.replacedMessageIds).toEqual(['evt_summary_regular']);
  });

  it('只通过正式 final_answer 事实投影 research writer 最终答案', () => {
    const result = projectFixture('research-writer-final-answer');
    const finalAnswer = result.rows.find(row => row.mergeKey === 'answer:answer_call_writer');

    expect(finalAnswer).toMatchObject({
      messageId: 'answer_call_writer',
      messageType: 'final_answer',
      content: 'final report',
      timestamp: 512,
    });
  });

  it('skips non-replayed chunk events while preserving interrupted final answer', () => {
    const result = projectFixture('interrupted-turn-with-skipped-chunk');

    expect(result.rows.map(row => row.messageId)).toEqual([
      'evt_user_interrupted',
      'answer_interrupted',
    ]);
    expect(result.rows[1]?.messageType).toBe('partial_answer');
    if (result.rows[0]?.messageType !== 'user_input') throw new Error('Expected interrupted user row');
    expect(result.rows[0].payload?.agent_work).toEqual({
      duration_ms: 40,
      ended_at: 640,
      outcome: 'cancelled',
    });
    expect(result.skipped).toEqual([
      expect.objectContaining({
        eventId: 'evt_chunk_interrupted',
        reason: 'event-governance-replay-disabled',
      }),
    ]);
  });

  it('keeps skip reasons explicit for audit', () => {
    const skipped = uiProjectionFixtures.flatMap(fixture => projectEventsWithMemoryApplier(fixture.events).skipped);

    expect(skipped.map(item => `${item.eventType}:${item.reason}`)).toEqual([
      'context_usage_snapshot:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'tool_process:event-governance-replay-disabled',
      'subrun_trace:event-governance-replay-disabled',
      'subrun_trace:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'final_answer_reset:event-governance-replay-disabled',
      'final_answer_chunk:event-governance-replay-disabled',
      'error:error-event-is-surface-state-not-timeline-row',
    ]);
  });

  it('把等待交互 form 修订到既有工具 row，reload 后不依赖临时 questionnaire id', () => {
    const result = projectFixture('interactive-tool-wait-and-run-error');
    const toolRow = result.rows.find(row => (
      row.mergeKey === conversationMessageIdFromToolIdentity(
        'run_interactive_error',
        'call_interactive',
      )
    ));

    expect(toolRow?.payload).toMatchObject({
      data: { questionnaireId: 'questionnaire_interactive' },
      interaction: {
        status: 'active',
        interactionId: 'interaction_interactive',
        runId: 'run_interactive_error',
        checkpointRevision: 1,
        resumeToken: 'resume_interactive',
      },
    });
  });
});
