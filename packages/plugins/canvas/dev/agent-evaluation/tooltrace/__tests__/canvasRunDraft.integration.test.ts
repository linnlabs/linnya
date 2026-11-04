import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CanvasCommandSchema, createCanvasPlainTextDocument, type CanvasSnapshot } from '../../../../src/shared';
import { planCanvasCommit } from '../../../../src/backend/features/canvasCommit';
import { checkCanvas } from '../../../../src/backend/features/canvasQuery';
import { evaluateCanvasAgentRun, createCanvasAgentFixture } from '../../../../scripts/agent-evaluation';
import { setupCanvasEvaluation, type EvaluationRunnerPorts } from '../../runner';
import { readRunnerState } from '../../runner/adapters/evidenceFiles';
import { parseCanvasToolTrace, buildCanvasRunDraft } from '../index';

it('T1正式setup的8份资料经过draft评分仍是8份，缺失、多余和错key不被过滤成成功', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-overview-draft-'));
  const source = input(), directory = path.join(root, 'run');
  let created = 0;
  const ports: EvaluationRunnerPorts = {
    async verifyRevision() {},
    async bridge() { throw new Error('This source admission test does not mount a Renderer'); },
    async cli(request) {
      if (request.args[0] === 'projects') return { exitCode: 0, value: { schema_version: 1, ok: true, command: 'projects', action: 'create', project: {
        project_id: 'project', name: 'overview', description: null, icon: null, system_role: null, created_at: 1, updated_at: 1, can_delete: true,
      } } };
      if (request.args[0] === 'tools') return { exitCode: 0, value: { ok: true, tool: { payload: { status: 'success', data: {
        documentId: ++created === 9 ? 'doc' : `source-${created}`,
      } } } } };
      return { exitCode: 0, value: { ok: true } };
    },
  };
  try {
    await setupCanvasEvaluation({ config: { ...source.state.config, repositoryRoot: path.join(root, 'source') }, outputDirectory: directory, ports });
    const state = await readRunnerState(directory);
    expect(created).toBe(9); expect(state.documentId).toBe('doc');
    expect(Object.keys(state.documentIds)).toHaveLength(8); expect(state.documentIds).not.toHaveProperty('canvas');
    const material = createCanvasAgentFixture('T1').documents;
    const operations = [
      ...material.map((document, index) => CanvasCommandSchema.parse({ op: 'addDocument', ref: `$document${index}`, width: 240, height: 120,
        x: index % 3 * 700, y: Math.floor(index / 3) * 200, data: { documentId: state.documentIds[document.key] } })),
      ...Array.from({ length: 3 }, (_, index) => CanvasCommandSchema.parse({ op: 'addText', ref: `$conclusion${index}`, width: 240, height: 120,
        x: index * 700 + 300, y: 0, content: createCanvasPlainTextDocument(`主题${index + 1}结论`) })),
      ...material.map((_document, index) => CanvasCommandSchema.parse({ op: 'connect', from: `$document${index}`, to: `$conclusion${index % 3}` })),
    ];
    const plan = planCanvasCommit({ state: { sequence: 0, maximumRevision: 0, nextCard: 1, nextEdge: 1, elements: [], deletedOrigins: {} },
      operations, actor: { viewId: 'fixture', source: { kind: 'user', conversationId: null, runId: null } }, origin: 'test', claims: [], now: 1 });
    const after: CanvasSnapshot = { schemaVersion: 1, documentId: state.documentId, sequence: plan.state.sequence, elements: plan.state.elements.map(row => row.element) };
    const check = source.facts.checks[0]; if (!check) throw new Error('Missing test check');
    const draft = buildCanvasRunDraft({ ...source, after, state: { ...source.state, ...state, phase: 'started', receipt: source.state.receipt, startedAt: 100 },
      facts: { ...source.facts, checks: [{ ...check, report: checkCanvas(after) }] } });
    expect(draft.kind).toBe('ready-for-review');
    if (draft.kind !== 'ready-for-review') throw new Error(draft.diagnostics.join('\n'));
    expect(evaluateCanvasAgentRun(draft.run)).toMatchObject({ status: 'needs_review', failures: [] });
    const identities = draft.run.documentIds;
    for (const documentIds of [
      Object.fromEntries(Object.entries(identities).filter(([key]) => key !== 'overview-8')),
      { ...identities, extra: 'source-extra' },
      Object.fromEntries(Object.entries(identities).map(([key, value]) => [key === 'overview-8' ? 'unexpected' : key, value])),
      { ...identities, 'overview-8': state.documentId },
    ]) expect(evaluateCanvasAgentRun({ ...draft.run, documentIds }).failures).toContainEqual(expect.objectContaining({ rule: '8-documents' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
  expect('review' in draft.partial).toBe(false);
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
