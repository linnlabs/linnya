import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CanvasCommandSchema, createCanvasPlainTextDocument, type CanvasSnapshot } from '../../../../src/shared';
import { planCanvasCommit } from '../../../../src/backend/features/canvasCommit';
import { createCanvasAgentFixture } from '../../../../scripts/agent-evaluation';
import { collectCanvasT13Metrics, parseCanvasToolTrace, buildCanvasT13Metrics, CanvasTraceMetricsEvidenceSchema } from '../index';
import { readCanvasT13Observations } from '../adapters/readCanvasT13Observations';
import type { CanvasEvaluationCommand } from '../../bridge/definitions/canvasEvaluationBridge';
import { CanvasT13ObservationSchema, CanvasT13FrameWindowSchema, CanvasT13ProtocolSchema } from '../definitions/canvasT13Metrics';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-t13-metrics-'));
  const run = path.join(root, 'run'), collectionDirectory = path.join(run, 'final'), observer = path.join(root, 'observer');
  await mkdir(collectionDirectory, { recursive: true }); await mkdir(observer);
  const scope = { sourceRevision: 'a'.repeat(40), batchId: 'batch', documentId: 'doc', conversationId: 'conv', runId: 'run' };
  const actor = { viewId: 'test', source: { kind: 'user', conversationId: null, runId: null } } as const;
  let state = planCanvasCommit({ state: { sequence: 0, maximumRevision: 0, nextCard: 1, nextEdge: 1, elements: [], deletedOrigins: {} },
    actor, operations: [], claims: [], origin: 'seed', now: 1 }).state;
  const seed = createCanvasAgentFixture('T13').userSeedOperations;
  for (let offset = 0; offset < seed.length; offset += 500)
    state = planCanvasCommit({ state, actor, operations: seed.slice(offset, offset + 500), claims: [], origin: `seed-${offset}`, now: 1 }).state;
  const snapshot = (): CanvasSnapshot => ({ schemaVersion: 1, documentId: 'doc', sequence: state.sequence, elements: state.elements.map(row => row.element) });
  const before = snapshot(), rows = [], outputs = [], commands: string[] = [];
  for (let batch = 0; batch < 2; batch++) {
    const computation = { origin: 'node-worker', requestId: `layout-${batch}`, sequence: state.sequence, algorithm: 'grid', executionMs: 400 + batch * 200 };
    const operations = Array.from({ length: 150 }, (_, index) => CanvasCommandSchema.parse({ op: 'addText',
      width: 240, height: 120,
      content: createCanvasPlainTextDocument(`本批发现 ${batch * 150 + index}`) }));
    const planned = planCanvasCommit({ state, actor: { ...actor, source: { kind: 'agent', conversationId: 'conv', runId: 'run' } },
      operations, claims: [], origin: `agent-${batch}`, now: 2 });
    state = planned.state;
    const commit = { documentId: 'doc', requestId: computation.requestId, sequence: state.sequence, refs: planned.refs, results: planned.results };
    outputs.push({ ...commit, status: 'committed', computation, replayed: false });
    commands.push(`linnya-canvas apply workspace:/T13.canvas --ops-file ops-${batch}.json --arrange grid --request-id layout-${batch}`);
    rows.push({ event: { documentId: 'doc', sequence: state.sequence, committedAt: 1000 + batch * 200, sourceKind: 'agent' },
      scope: { sequence: state.sequence, cards: planned.changes.flatMap(change => change.after && change.after.type !== 'edge'
        ? [{ id: change.after.id, revision: change.after.revision }] : []), deletedCardIds: [] } });
  }
  const after = snapshot();
  const runnerState = { config: { repositoryRoot: '/source', sourceRevision: scope.sourceRevision, batchId: 'batch', taskId: 'T13',
    modelConfigId: 'configured', model: { provider: 'test', model: 'test', version: 'test' }, imageCapability: 'no-vision', repetition: 1, evidenceMode: 'not-applicable' },
    projectId: 'project', documentId: 'doc', documentIds: {}, phase: 'started', startedAt: 900,
    receipt: { conversation_id: 'conv', run_id: 'run', user_message_id: 'msg', turn_id: 'turn', execution_id: 'exec', agent_id: 'default', accepted_at: 901 } };
  const collectionFields = { sourceRevision: scope.sourceRevision, batchId: scope.batchId,
    conversationId: scope.conversationId, runId: scope.runId, taskId: 'T13', collectedAt: 2100, errors: [], sourceValid: true,
    messagesComplete: true, evidenceComplete: true, scoring: 'not-performed', manualActions: null };
  const result = { schema_version: 1, ok: true, command: 'result', conversation_id: 'conv', run_id: 'run',
    outcome: 'completed', completed_at: 1900, result_status: 'unavailable', reason: 'final_answer_missing' };
  const audit = { schema_version: 1, ok: true, command: 'audit', conversation_id: 'conv', requested_run_id: 'run',
    completeness: { run_registry: 'complete', event_store: 'complete', telemetry: 'best_effort', telemetry_retention_days: 7 },
    runs: [{ run_id: 'run', status: 'completed', started_at: 900, updated_at: 1900 }] };
  const messages = outputs.map((output, index) => ({ message_id: `m${index}`, conversation_id: 'conv', turn_id: 'turn', role: 'assistant',
    message_type: 'tool_calls', sort_seq: index + 1, timestamp: 1000 + index * 200, content: '', merge_key: `tool:${index}`, presentation: null, run_id: 'run',
    payload: { tool_call_id: `call-${index}`, tool_name: 'shell', status: 'success', phase: 'complete', started_at: 950 + index * 200, completed_at: 1010 + index * 200,
      args: { command: commands[index] },
      data: { status: 'completed', presentationText: 'stdout:\n' + JSON.stringify(output), display: { mode: 'pipe', coverage: 'complete', outputPhase: 'closed', textProjection: 'available' },
        terminal: { outcome: 'exited', exitCode: 0 }, command_output_store: { stdout: { status: 'published', completeness: 'complete' } } } } }));
  const page = { schema_version: 1, ok: true, command: 'messages', conversation_id: 'conv', status: 'ready', messages,
    has_more_before: false, has_more_after: false, revision: 1 };
  const facts = parseCanvasToolTrace({ scope: { conversationId: 'conv', rootRunId: 'run', documentId: 'doc', locators: ['workspace:/T13.canvas'] },
    audit, pages: [{ sourceFile: path.join(collectionDirectory, 'messages-1.response.json'), value: page }] });
  expect(facts.diagnostics).toEqual([]);
  const save = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value), { flag: 'wx' });
  await Promise.all([[path.join(run, 'state.json'), runnerState], [path.join(run, 'before.json'), before],
    [path.join(collectionDirectory, 'collection.json'), collectionFields], [path.join(collectionDirectory, 'after.json'), after],
    [path.join(collectionDirectory, 'result.response.json'), result], [path.join(collectionDirectory, 'audit.response.json'), audit],
    [path.join(collectionDirectory, 'messages-index.json'), { complete: true, files: ['messages-1.response.json'] }],
    [path.join(collectionDirectory, 'messages-1.response.json'), page]].map(async ([file, value]) => {
      if (typeof file !== 'string') throw new Error('Fixture filename missing'); await save(file, value);
    }));
  let call = 0;
  async function exchange(kind: CanvasEvaluationCommand['kind'], payload: unknown, value: unknown, requestedAt: number, receivedAt: number) {
    const id = randomUUID(), prefix = path.join(observer, `${String(++call).padStart(5, '0')}-${kind}`);
    await save(prefix + '.request.json', { command: { id, kind, payload }, requestedAt });
    await save(prefix + '.response.json', { receivedAt, status: 200, raw: JSON.stringify({ id, ok: true, value }) });
  }
  await exchange('read', {}, { snapshot: before }, 780, 790);
  const initialEnvironment = { visibilityState: 'visible', screenPixelRatio: 2, camera: { x: 0, y: 0, zoom: 1 } };
  await exchange('readiness', { elementIds: before.elements.map(card => card.id) }, { documentId: 'doc', sequence: before.sequence,
    renders: 1, observedAt: 795, environment: initialEnvironment, readiness: {
      cards: before.elements.map(card => ({ id: card.id, revision: card.revision, mode: 'overview', status: 'not_required' })),
      complete: false, suspended: false, precisionSettling: false } }, 792, 798);
  const protocol = { ...scope, projectId: 'project', startedAt: 800, initialSequence: before.sequence,
    naturalEnvironment: initialEnvironment,
    measurement: 'backend-commit-to-post-fit-observed-overview-geometry-upper-bound', body: 'separate-not-implied' };
  const observations = [];
  for (const [index, row] of rows.entries()) {
    const observedAt = index === 0 ? 1500 : 1700, receivedAt = observedAt + 10;
    const fit = { camera: { x: 30, y: 30, zoom: .1 }, renders: index + 1, sceneTransitions: 0, observedAt: index === 0 ? 1002 : 1552 };
    const readiness = { documentId: 'doc', sequence: row.event.sequence, renders: index + 2, observedAt,
      readiness: { cards: row.scope.cards.map(card => ({ ...card, mode: 'overview', status: 'not_required' })),
        complete: false, suspended: false, precisionSettling: false }, environment: { ...initialEnvironment, camera: fit.camera } };
    const natural = { ...readiness, observedAt: fit.observedAt - 4, renders: fit.renders,
      environment: index === 0 ? initialEnvironment : readiness.environment };
    const frameSamples = index === 0 ? [{ at: 1100, interval: 100 }, { at: 1300, interval: 200 }, { at: 1500, interval: 200 }]
      : [{ at: 1300, interval: 200 }, { at: 1500, interval: 200 }, { at: 1700, interval: 200 }];
    const frameWindow = { documentId: 'doc', frames: { kind: 'animation-frame-callbacks-in-explicit-window', since: row.event.committedAt,
      until: observedAt, observedAt: receivedAt + 3, retainedSince: 900, capturedThrough: observedAt, retentionComplete: true,
      visibility: 'visible', focused: true, samples: frameSamples, boundarySamples: index ? [frameSamples[0]] : [] } };
    const observation = { sequence: row.event.sequence, status: 'geometry-observed', row, targets: row.scope.cards, natural, fit,
      samples: [{ readiness, presentation: { sceneTransitions: 0 }, receivedAt }],
      receipt: { sequence: row.event.sequence, status: 'geometry-observed', observedAt, receivedAt, renders: index + 2, zeroBaseline: index + 1 }, frameWindow };
    observations.push(observation);
    await exchange('readiness', { elementIds: row.scope.cards.map(card => card.id) }, natural, natural.observedAt - 1, natural.observedAt + 1);
    await exchange('fit', {}, fit, fit.observedAt - 1, fit.observedAt + 1);
    await exchange('readiness', { elementIds: row.scope.cards.map(card => card.id) }, readiness, observedAt - 1, receivedAt);
    await exchange('stats', {}, { presentation: { sceneTransitions: 0, renders: readiness.renders }, commits: { rows } }, receivedAt + 1, receivedAt + 2);
    await exchange('frame-window', { since: row.event.committedAt, until: observedAt }, frameWindow, receivedAt + 3, receivedAt + 4);
    await save(path.join(observer, `delta-${row.event.sequence}.json`), observation);
  }
  const summary = { ...scope, endedAt: 2000, terminalObservedAt: 1950, sampleCount: observations.length };
  await save(path.join(observer, 'protocol.json'), protocol); await save(path.join(observer, 'summary.json'), summary);
  return { root, run, observer, facts, outputs, messages, audit, page, input: { state: runnerState, collection: collectionFields,
    before, after, result, facts, ...await readCanvasT13Observations(observer) } };
}

it('正式2000→2300双批原件闭合；重叠RAF去重、慢Worker/帧保真实数值，不在collector判阈值', async () => {
  const data = await fixture();
  try {
    const outputDirectory = path.join(data.root, 'metrics');
    const outcome = await collectCanvasT13Metrics({ request: { runDirectory: data.run, collectionLabel: 'final', observationDirectory: data.observer }, outputDirectory });
    expect(outcome.kind).toBe('complete');
    const result: unknown = JSON.parse(await readFile(outcome.metricsFile, 'utf8'));
    expect(result).toMatchObject({ scope: { runId: 'run', documentId: 'doc' }, metrics: { layoutWorkerP50Ms: 400,
      commitToFrameP95Ms: 510, averageFps: 4 * 1000 / 700, frameP95Ms: 200, worstFrameMs: 200 } });
    const derived: unknown = JSON.parse(await readFile(path.join(outputDirectory, 'metrics-facts.json'), 'utf8'));
    expect(derived).toMatchObject({ workerSampleCount: 2, commitSampleCount: 2, frameSampleCount: 4 });
    await expect(collectCanvasT13Metrics({ request: { runDirectory: data.run, collectionLabel: 'final', observationDirectory: data.observer }, outputDirectory })).rejects.toThrow();
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

it('错run/文档拒绝归属，旧revision、缺raw窗口与空Worker样本只给partial而不补0', async () => {
  const data = await fixture();
  try {
    expect(() => buildCanvasT13Metrics({ ...data.input, facts: { ...data.facts,
      scope: { ...data.facts.scope, rootRunId: 'other-run' } } })).toThrow('another evaluation');
    expect(() => buildCanvasT13Metrics({ ...data.input, protocol: {
      ...CanvasT13ProtocolSchema.parse(data.input.protocol), documentId: 'other-doc' } })).toThrow('another frozen evaluation');
    const missing = buildCanvasT13Metrics({ ...data.input, exchanges: data.input.exchanges.filter(value => value.command.kind !== 'frame-window'),
      facts: { ...data.facts, layoutComputations: [] } });
    expect(missing.kind).toBe('needs-evidence'); expect(missing.witness.metrics.layoutWorkerP50Ms).toBeUndefined();
    expect(missing.diagnostics).toContain('node_worker_samples_missing');
    const first = data.input.observations[0];
    if (typeof first !== 'object' || first === null) throw new Error('Fixture observation missing');
    const changed = { ...first, targets: [{ id: 'c2001', revision: 99 }] };
    expect(buildCanvasT13Metrics({ ...data.input, observations: [changed, data.input.observations[1]] }).diagnostics)
      .toContain('target_revision_scope_mismatch:5');
    const dropped = buildCanvasT13Metrics({ ...data.input, observations: [] });
    expect(dropped.kind).toBe('needs-evidence'); expect(dropped.witness.metrics.averageFps).toBeUndefined();
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

it('真实HTTP响应ID不符与窗口retention不足各自失效，不借派生delta补出成功观测', async () => {
  const data = await fixture();
  try {
    const observation = CanvasT13ObservationSchema.parse(data.input.observations[0]);
    if (!observation.frameWindow) throw new Error('Fixture frame window missing');
    const frameWindow = { ...observation.frameWindow, frames: { ...observation.frameWindow.frames, retentionComplete: false } };
    const exchanges = data.input.exchanges.map(exchange => {
      const parsed = CanvasT13FrameWindowSchema.safeParse(exchange.value);
      return exchange.command.kind === 'frame-window' && parsed.success && parsed.data.frames.until === frameWindow.frames.until
        ? { ...exchange, value: frameWindow } : exchange;
    });
    expect(buildCanvasT13Metrics({ ...data.input, observations: [{ ...observation, frameWindow }, data.input.observations[1]], exchanges }).diagnostics)
      .toContain('frame_window_incomplete:5');
    const readiness = data.input.exchanges.find(exchange => exchange.command.kind === 'readiness'
      && exchange.receivedAt === observation.receipt?.receivedAt);
    if (!readiness) throw new Error('Fixture readiness missing');
    await writeFile(readiness.responseFile, JSON.stringify({ receivedAt: readiness.receivedAt, status: 200,
      raw: JSON.stringify({ id: randomUUID(), ok: true, value: readiness.value }) }));
    const raw = await readCanvasT13Observations(data.observer);
    const result = buildCanvasT13Metrics({ ...data.input, ...raw });
    expect(result.kind).toBe('needs-evidence');
    expect(result.diagnostics.some(reason => reason.startsWith('bridge_response_not_confirmed:'))).toBe(true);
    expect(result.diagnostics).toContain('raw_readiness_proof_missing:5');
    const partial = await collectCanvasT13Metrics({ request: { runDirectory: data.run, collectionLabel: 'final', observationDirectory: data.observer },
      outputDirectory: path.join(data.root, 'partial') });
    const artifact: unknown = JSON.parse(await readFile(partial.metricsFile, 'utf8'));
    expect(CanvasTraceMetricsEvidenceSchema.safeParse(artifact).success).toBe(false);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

it('replayed/缺非重放事实/错请求计时不能进入Worker样本；重复同编号不二次计数', async () => {
  const data = await fixture();
  try {
    for (const replacement of [{ replayed: true }, { replayed: undefined }, { computation: { ...data.outputs[0].computation, requestId: 'other' } }]) {
      const messages = data.messages.map((message, index) => index ? message : { ...message, payload: { ...message.payload,
        data: { ...message.payload.data, presentationText: 'stdout:\n' + JSON.stringify({ ...data.outputs[0], ...replacement }) } } });
      const facts = parseCanvasToolTrace({ scope: data.facts.scope, audit: data.audit,
        pages: [{ sourceFile: 'messages.json', value: { ...data.page, messages } }] });
      expect(facts.layoutComputations).toHaveLength(1); expect(facts.needsReview).toBe(true);
    }
    const duplicate = data.messages[0];
    const facts = parseCanvasToolTrace({ scope: data.facts.scope, audit: data.audit,
      pages: [{ sourceFile: 'messages.json', value: { ...data.page, messages: [...data.messages,
        { ...duplicate, message_id: 'replay', sort_seq: 3, payload: { ...duplicate.payload, tool_call_id: 'replay' } }] } }] });
    expect(facts.layoutComputations).toHaveLength(2); expect(facts.replays).toHaveLength(1);
    const incomplete = data.messages.map((message, index) => index ? message : { ...message, payload: { ...message.payload,
      data: { ...message.payload.data, presentationText: 'stdout:\n' + JSON.stringify({ ...data.outputs[0], computation: undefined }) } } });
    const missing = parseCanvasToolTrace({ scope: data.facts.scope, audit: data.audit,
      pages: [{ sourceFile: 'messages.json', value: { ...data.page, messages: incomplete } }] });
    expect(missing.layoutComputations).toHaveLength(1); expect(missing.layoutComputationGaps).toHaveLength(1);
    expect(buildCanvasT13Metrics({ ...data.input, facts: missing }).diagnostics).toContain('node_worker_sample_coverage_incomplete');
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

it('动画未结束时readiness后才draw到zero，旧readiness计数不能冒充zero后的新draw', async () => {
  const data = await fixture();
  try {
    const observation = CanvasT13ObservationSchema.parse(data.input.observations[0]);
    if (!observation.fit || !observation.samples?.[0]) throw new Error('Fixture motion facts missing');
    const fit = { ...observation.fit, sceneTransitions: 1 }, last = observation.samples[0];
    const early = { ...last, readiness: { ...last.readiness, renders: 1, observedAt: 1400 }, receivedAt: 1410 };
    const zeroCommand: CanvasEvaluationCommand = { id: randomUUID(), kind: 'stats', payload: {} };
    const zeroStats = { command: zeroCommand, requestedAt: 1411, receivedAt: 1412, value: {
      presentation: { sceneTransitions: 0, renders: 2 }, commits: { rows: [observation.row] } }, requestFile: 'zero.request.json', responseFile: 'zero.response.json' };
    const exchanges = data.input.exchanges.map(exchange => exchange.command.kind === 'fit'
      && exchange.receivedAt === fit.observedAt + 1 ? { ...exchange, value: fit } : exchange);
    const result = buildCanvasT13Metrics({ ...data.input, exchanges: [...exchanges, zeroStats],
      observations: [{ ...observation, fit, samples: [early, last] }, data.input.observations[1]] });
    expect(result.kind).toBe('needs-evidence'); expect(result.diagnostics).toContain('post_zero_actual_draw_missing:5');
    const actualZeroBeforeDraw = { ...zeroStats, value: { ...zeroStats.value, presentation: { sceneTransitions: 0, renders: 1 } } };
    expect(buildCanvasT13Metrics({ ...data.input, exchanges: [...exchanges, actualZeroBeforeDraw],
      observations: [{ ...observation, fit, samples: [early, last] }, data.input.observations[1]] }).kind).toBe('complete');
  } finally { await rm(data.root, { recursive: true, force: true }); }
});
