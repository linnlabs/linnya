import { expect, it } from 'vitest';
import { parseCanvasToolTrace, buildCanvasRunDraft } from '../index';

const scope = {
  sourceRevision: 'a'.repeat(40),
  batchId: 'batch',
  documentId: 'doc',
  conversationId: 'conv',
  runId: 'run',
};
function input() {
  const state = {
    config: {
      repositoryRoot: '/source',
      sourceRevision: scope.sourceRevision,
      batchId: scope.batchId,
      taskId: 'T1',
      modelConfigId: 'configured',
      model: { provider: 'test', model: 'test', version: 'test' },
      imageCapability: 'no-vision',
      repetition: 1,
      evidenceMode: 'not-applicable',
    },
    projectId: 'project',
    documentId: scope.documentId,
    documentIds: {},
    phase: 'started',
    startedAt: 100,
    receipt: {
      conversation_id: scope.conversationId,
      run_id: scope.runId,
      user_message_id: 'message',
      turn_id: 'turn',
      execution_id: 'exec',
      agent_id: 'default',
      accepted_at: 101,
    },
  };
  const snapshot = { schemaVersion: 1, documentId: 'doc', sequence: 1, elements: [] };
  const facts = parseCanvasToolTrace({
    scope: {
      conversationId: 'conv',
      rootRunId: 'run',
      documentId: 'doc',
      locators: ['workspace:/T1.canvas'],
    },
    audit: {
      schema_version: 1,
      ok: true,
      command: 'audit',
      conversation_id: 'conv',
      requested_run_id: 'run',
      completeness: {
        run_registry: 'complete',
        event_store: 'complete',
        telemetry: 'best_effort',
        telemetry_retention_days: 7,
      },
      runs: [{ run_id: 'run', status: 'completed', started_at: 100, updated_at: 250 }],
    },
    pages: [
      {
        sourceFile: 'messages.json',
        value: {
          schema_version: 1,
          ok: true,
          command: 'messages',
          conversation_id: 'conv',
          status: 'ready',
          messages: [],
          has_more_before: false,
          has_more_after: false,
          revision: 1,
        },
      },
    ],
  });
  facts.checks.push({
    toolCallId: 'check',
    sourceFile: 'messages.json',
    order: 1,
    report: {
      sequence: 1,
      cardCount: 0,
      edgeCount: 0,
      overlapCount: 0,
      crossingCount: 0,
      overlaps: [],
      crossings: [],
      longEdges: [],
      outliers: [],
      note: 'formal check',
    },
  });
  return {
    state,
    before: snapshot,
    after: snapshot,
    facts,
    collection: {
      sourceRevision: scope.sourceRevision,
      batchId: scope.batchId,
      taskId: 'T1',
      collectedAt: 900,
      conversationId: 'conv',
      runId: 'run',
      errors: [],
      sourceValid: true,
      messagesComplete: true,
      evidenceComplete: true,
      scoring: 'not-performed',
      manualActions: null,
    },
    result: {
      schema_version: 1,
      ok: true,
      command: 'result',
      conversation_id: 'conv',
      run_id: 'run',
      outcome: 'completed',
      completed_at: 250,
      result_status: 'unavailable',
      reason: 'final_answer_missing',
    },
    controls: {
      scope,
      approvalShown: false,
      approvalDecision: null,
      editedCardId: null,
      evidenceFiles: ['ui-observation.json'],
    },
    evidenceFiles: ['messages.json'],
  };
}

it('drafts terminal time from official result and leaves manual review and absent performance unset', () => {
  const result = buildCanvasRunDraft(input());
  expect(result.kind).toBe('ready-for-review');
  if (result.kind !== 'ready-for-review') throw new Error(result.diagnostics.join('\n'));
  expect(result.run.finishedAt).toBe(250);
  expect(result.run.finishedAt).not.toBe(900);
  expect(result.run.review).toBeUndefined();
  expect(result.run.metrics).toEqual({});
  expect(result.run.attempts).toEqual([]);
});

it('retains incomplete facts as a partial instead of turning unknown UI or stale check into accepted evidence', () => {
  const source = input();
  source.facts.needsReview = true;
  const result = buildCanvasRunDraft({
    ...source,
    controls: undefined,
    after: { ...source.after, sequence: 2 },
  });
  expect(result.kind).toBe('needs-evidence');
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      'tooltrace_needs_review',
      'trusted_ui_controls_missing',
      'final_sequence_check_missing',
    ])
  );
});

it('rejects borrowed scope and snapshots rather than projecting another task as this result', () => {
  const source = input();
  expect(() =>
    buildCanvasRunDraft({
      ...source,
      controls: { ...source.controls, scope: { ...scope, runId: 'different-run' } },
    })
  ).toThrow('another evaluation run');
  expect(() =>
    buildCanvasRunDraft({ ...source, after: { ...source.after, documentId: 'different-document' } })
  ).toThrow('another Canvas document');
});

it('keeps dry-run identity absence and chronological phases visible in partial evidence', () => {
  const source = input();
  source.facts.needsReview = true;
  const event = {
    toolCallId: 'write',
    sourceFile: 'messages.json',
    runId: 'run',
    order: 2,
    kind: 'apply' as const,
    outcome: 'committed' as const,
    validationAccepted: true,
    correction: true,
    fingerprint: null,
    inputKey: null,
  };
  source.facts.attempts.push({ ...event, requestId: 'actual-write' });
  source.facts.dryRuns.push({
    ...event,
    order: 1,
    requestId: null,
    outcome: 'rejected',
    validationAccepted: false,
    correction: false,
  });
  const draft = buildCanvasRunDraft(source);
  expect(draft.kind).toBe('needs-evidence');
  if (draft.kind !== 'needs-evidence') throw new Error('Unknown trace must remain partial');
  expect(draft.partial.attempts.map(value => [value.phase, value.requestId])).toEqual([
    ['dry-run', null],
    ['write', 'actual-write'],
  ]);
});
