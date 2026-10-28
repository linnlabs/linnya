import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionRecommendation } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';

let db: Database.Database; let directory: string; let id: string; let actionId: string;
const plan = { label: '核对安排', purpose: '询问A的条件', inputIds: ['a_remote'], executor: 'user', estimatedCost: '5分钟、0元' };
const provenance = { kind: 'agent_report', conversationId: 'synthetic', agentRunId: 'synthetic-run' } as const;
function run(argv: string[], project = 'p') {
  const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('Expected inline command');
  return executeDecisionCommand(command, db, project, provenance);
}
function read(revision?: number) {
  const result = run(['read', id, ...(revision ? ['--revision', String(revision)] : [])]);
  if (typeof result !== 'object' || result === null || !('record' in result)) throw new Error('Expected record');
  return result;
}
function save(content: DecisionRecommendation = { ...remoteOfferRecommendation(['b']), actionBasis: { actionIds: [actionId] } }) {
  return run(['recommend', id, '--expected-revision', String(read().record.revision), '--json', JSON.stringify(content)]);
}
function review() {
  return run(['action', 'review', id, actionId, '--expected-revision', String(read().record.revision), '--json', JSON.stringify({
    plan: { ...plan, purpose: '现在改问B的条件', inputIds: ['b_remote'] }, reason: '变更核对对象', origin: '作者明确复核',
  })]);
}
const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'decision-advice-actions-')); db = new Database(join(directory, 'state.sqlite'));
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
  for (const migration of decisionMigrations) migration.up(db);
  const created = run(['create', '--json', JSON.stringify(remoteOfferModel())]);
  if (typeof created !== 'object' || created === null || !('record' in created)) throw new Error('Expected record');
  id = created.record.id;
  run(['action', 'plan', id, '--expected-revision', '1', '--json', JSON.stringify(plan)]);
  const action = read().record.actions?.[0]; if (!action) throw new Error('Expected action'); actionId = action.id;
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

it('invalidates bound advice on plan-only changes consistently, preserves old text and rebinds only on an explicit new recommendation', () => {
  save(); const saved = read(); const previous = saved.record.recommendation;
  expect(previous?.actionObservations?.[0]?.actionId).toBe(actionId);
  review(); const changed = read();
  expect(changed.record.inputRevision).toBe(saved.record.inputRevision);
  expect(changed.record.recommendation).toEqual(previous);
  expect(changed.recommendationStatus).toBe('needs_review');
  expect(changed.recommendationContext).toMatchObject({ inputStatus: 'current', actionBasis: { status: 'needs_review', actions: [{ status: 'changed', current: { planRevision: 2 } }] } });
  expect(changed.recommendationBasis?.status).toBe('needs_review'); expect(changed.conditionalAdvice?.status).toBe('needs_review');
  expect(run(['list'])).toMatchObject([{ recommendationStatus: 'needs_review' }]);
  const before = rows();
  expect(run(['compare', id, '--from', String(saved.record.revision), '--to', String(changed.record.revision)]))
    .toMatchObject({ recommendations: { from: { status: 'current' }, to: { status: 'needs_review' }, contentChanged: false } });
  expect(rows()).toEqual(before); expect(read(saved.record.revision)).toEqual(saved);
  save(); db.close(); db = new Database(join(directory, 'state.sqlite'));
  expect(read().recommendationStatus).toBe('current');
  expect(read().recommendationContext.actionBasis).toMatchObject({ status: 'current', actions: [{ status: 'unchanged' }] });
});

it('leaves unrelated actions and recommendation-only revisions out of the observed context', () => {
  save(); const observed = read().record.recommendation?.actionObservations;
  run(['action', 'plan', id, '--expected-revision', String(read().record.revision), '--json', JSON.stringify({ ...plan, purpose: '另查无关场地' })]);
  expect(read().recommendationStatus).toBe('current'); expect(read().record.recommendation?.actionObservations).toEqual(observed);
  save(); expect(read().recommendationStatus).toBe('current'); expect(read().record.recommendation?.actionObservations).toEqual(observed);
});

it('keeps old advice explicitly unobserved and requires intentional replacement or disabling once binding is enabled', () => {
  save(remoteOfferRecommendation(['b'])); const old = read(); review();
  expect(read().recommendationContext).toMatchObject({ status: 'current', actionBasis: { status: 'not_observed' } });
  expect(old.record.recommendation?.actionObservations).toBeUndefined();
  save(); const before = rows(); expect(() => save(remoteOfferRecommendation(['b']))).toThrow('actionBasis'); expect(rows()).toEqual(before);
  const prior = read().record.revision;
  save({ ...remoteOfferRecommendation(['b']), actionBasis: null });
  expect(read().recommendationContext.actionBasis.status).toBe('not_observed');
  expect(run(['compare', id, '--from', String(prior), '--to', String(read().record.revision)]))
    .toMatchObject({ analysisChanges: { actionBasis: { beforeEnabled: true, afterEnabled: false, targetDisposition: 'disabled' } } });
});

it('rejects missing/duplicate/forged observations, stale revisions and cross-project references without appending', () => {
  const content = remoteOfferRecommendation(['b']); const before = rows();
  expect(() => save({ ...content, actionBasis: { actionIds: [actionId, actionId] } })).toThrow('Duplicate recommendation action');
  expect(() => save({ ...content, actionBasis: { actionIds: ['00000000-0000-4000-8000-000000000001'] } })).toThrow('Unknown recommendation action');
  expect(() => run(['recommend', id, '--expected-revision', '2', '--json', JSON.stringify({ ...content, actionObservations: [] })])).toThrow();
  expect(() => run(['recommend', id, '--expected-revision', '1', '--json', JSON.stringify({ ...content, actionBasis: { actionIds: [actionId] } })])).toThrow('Revision conflict');
  expect(() => run(['recommend', id, '--expected-revision', '2', '--json', JSON.stringify(content)], 'other')).toThrow('not found');
  expect(rows()).toEqual(before);
});

it('binds file-bridge recommendations to actual saved actions and requires reconsideration after partial and final reports', async () => {
  const content = { ...remoteOfferRecommendation(['b']), actionBasis: { actionIds: [actionId] } };
  writeFileSync(join(directory, 'advice.json'), JSON.stringify(content));
  const prepared = decisionPluginCli.prepare({ argv: ['recommend', id, '--expected-revision', '2', '--input', 'advice.json'], conversationRoot: directory, invocationId: 'save' });
  if (prepared.status !== 'ready') throw new Error('Expected ready');
  const result = await prepared.plan.execute({ projectId: 'p', conversationId: 'synthetic', agentRunId: 'synthetic-run', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal });
  expect(result.exitCode).toBe(0); expect(read().recommendationStatus).toBe('current');
  const observed = DecisionRecordSchema.parse(read().record).recommendation?.actionObservations;
  run(['action', 'progress', id, actionId, '--expected-revision', String(read().record.revision), '--json', JSON.stringify({ planRevision: 1, summary: '第一处已问', origin: '用户报告', actualCost: '本次2分钟' })]);
  expect(read().recommendationStatus).toBe('needs_review'); expect(read().record.recommendation?.actionObservations).toEqual(observed);
  review(); save();
  run(['action', 'resolve', id, actionId, '--expected-revision', String(read().record.revision), '--json', JSON.stringify({ planRevision: 2, outcome: 'completed', summary: '已问完', origin: '用户报告', actualCost: '本次2分钟' })]);
  expect(read().recommendationStatus).toBe('needs_review'); save();
  expect(read().recommendationContext).toMatchObject({ status: 'current', actionBasis: { actions: [{ current: { continuation: 'closed' } }] } });
});
