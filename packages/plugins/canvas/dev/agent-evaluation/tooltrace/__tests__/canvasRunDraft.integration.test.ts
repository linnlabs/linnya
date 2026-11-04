import { expect, it } from 'vitest';
import { evaluateCanvasAgentRun } from '../../../../scripts/agent-evaluation';
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

it('有当前run字面编号的只读回执只补commit，过滤stdout仍须复核且不补attempts或分数', () => {
  const source = input();
  source.facts.needsReview = true;
  source.facts.requests.push({
    requestId: 'literal',
    runId: 'run',
    toolCallId: 'call',
    sourceFile: 'messages.json',
    order: 2,
  });
  const draft = buildCanvasRunDraft({
    ...source,
    receiptWitness: {
      scope,
      projectId: 'project',
      documentPath: 'workspace:/T1.canvas',
      reader: { cliEntry: '/artifact/cli.cjs', sha256: 'b'.repeat(64), hostAppRoot: '/source' },
      complete: true,
      queries: [
        {
          requestId: 'literal',
          exitCode: 0,
          responseFile: '/receipt.json',
          failure: null,
          response: {
            documentId: 'workspace:/T1.canvas',
            receipt: {
              requestId: 'literal',
              status: 'committed',
              pendingId: null,
              commit: {
                documentId: 'workspace:/T1.canvas',
                requestId: 'literal',
                sequence: 1,
                refs: {},
                results: [],
              },
            },
          },
        },
      ],
      evidenceFiles: ['/receipt.json'],
    },
  });
  expect(draft.kind).toBe('needs-evidence');
  if (draft.kind !== 'needs-evidence') throw new Error('Unknown stdout must remain partial');
  expect(draft.partial.commits).toEqual([
    { documentId: 'doc', requestId: 'literal', sequence: 1, refs: {}, results: [] },
  ]);
  expect(draft.partial.attempts).toEqual([]);
  expect(draft.partial.review).toBeUndefined();
  expect(draft.partial.metrics).toEqual({});
  expect(draft.partial.evidenceFiles).toContain('/receipt.json');
  expect(draft.diagnostics).toContain('tooltrace_needs_review');
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
it('正式write与无编号dry-run完整事实可生成run.json草稿，保留首败而不填写人工评分', () => {
  const source = input();
  const event = {
    toolCallId: 'write',
    sourceFile: 'messages.json',
    runId: 'run',
    order: 3,
    kind: 'apply' as const,
    outcome: 'committed' as const,
    validationAccepted: true,
    correction: false,
    fingerprint: 'verified-literal-content',
    inputKey: 'ops.json',
  };
  source.facts.dryRuns.push({
    ...event,
    order: 1,
    requestId: null,
    outcome: 'rejected',
    validationAccepted: false,
  });
  source.facts.dryRuns.push({
    ...event,
    order: 2,
    requestId: null,
    outcome: 'previewed',
    correction: true,
  });
  source.facts.attempts.push({ ...event, requestId: 'real-write' });
  source.facts.commits.push({
    documentId: 'doc',
    requestId: 'real-write',
    sequence: 1,
    refs: {},
    results: [],
  });
  const draft = buildCanvasRunDraft(source);
  expect(draft.kind).toBe('ready-for-review');
  if (draft.kind !== 'ready-for-review') throw new Error(draft.diagnostics.join('\n'));
  expect(
    draft.run.attempts.map(attempt => [
      attempt.phase,
      attempt.requestId,
      attempt.validationAccepted,
      attempt.correction,
    ])
  ).toEqual([
    ['dry-run', null, false, false],
    ['dry-run', null, true, true],
    ['write', 'real-write', true, false],
  ]);
  expect(draft.run.controls.imageReadSequence).toBeNull();
  expect(evaluateCanvasAgentRun(draft.run)).toMatchObject({
    firstSubmissionAccepted: true,
    correctionRetries: 1,
  });
  expect(draft.run.review).toBeUndefined();
  expect(draft.run.metrics).toEqual({});
});
it('实际读图必须对应先前的同工具render，保留最后读图序号而不强改成after', () => {
  const source = input();
  source.state.config.imageCapability = 'vision';
  source.facts.renders.push({
    sequence: 1,
    locator: 'conversation:/image-1.png',
    runId: 'run',
    toolCallId: 'render-1',
    sourceFile: 'messages.json',
    order: 2,
  });
  source.facts.imageReads.push({
    locator: 'conversation:/image-1.png',
    renderToolCallId: 'render-1',
    toolCallId: 'read-1',
    sourceFile: 'messages.json',
    order: 3,
  });
  const latest = buildCanvasRunDraft(source);
  expect(latest.kind).toBe('ready-for-review');
  if (latest.kind !== 'ready-for-review') throw new Error(latest.diagnostics.join('\n'));
  expect(latest.run.controls).toMatchObject({
    renderCount: 1,
    imageReadCount: 1,
    imageReadSequence: 1,
  });
  expect(
    evaluateCanvasAgentRun(latest.run).checks.find(check => check.rule === 'actual-render-and-read')
      ?.passed
  ).toBe(true);
  const laterSnapshot = buildCanvasRunDraft({
    ...source,
    after: { ...source.after, sequence: 2 },
    facts: {
      ...source.facts,
      checks: source.facts.checks.map(check => ({
        ...check,
        report: { ...check.report, sequence: 2 },
      })),
    },
  });
  expect(laterSnapshot.kind).toBe('ready-for-review');
  if (laterSnapshot.kind !== 'ready-for-review')
    throw new Error(laterSnapshot.diagnostics.join('\n'));
  expect(laterSnapshot.run.after.sequence).toBe(2);
  expect(laterSnapshot.run.controls.imageReadSequence).toBe(1);
  expect(
    evaluateCanvasAgentRun(laterSnapshot.run).checks.find(
      check => check.rule === 'actual-render-and-read'
    )?.passed
  ).toBe(false);
  source.facts.imageReads.push({
    locator: 'conversation:/missing-render.png',
    renderToolCallId: 'missing',
    toolCallId: 'read-unknown',
    sourceFile: 'messages.json',
    order: 4,
  });
  expect(buildCanvasRunDraft(source)).toMatchObject({
    kind: 'needs-evidence',
    diagnostics: expect.arrayContaining(['image_read_render_link_missing']),
  });
});
