import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionActionPlan } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';

let db: Database.Database; let directory: string; let id: string; let actionId: string;
const plan: DecisionActionPlan = { label: '分两次核对两处安排', purpose: '问清适用条件，不把一处确认推广至全部', inputIds: ['a_remote'], executor: 'user', estimatedCost: '预计6分钟，0元' };
const provenance = { kind: 'agent_report', conversationId: 'synthetic', agentRunId: 'synthetic-run' } as const;
const progress = { summary: '已询问第一处，第二处尚未问', origin: '合成用户报告', actualCost: '本次3分钟、0元' };
function run(argv: string[], project = 'p') {
  const cmd = parseDecisionCli(argv); if (cmd.kind === 'file') throw new Error('Inline expected');
  return executeDecisionCommand(cmd, db, project, provenance);
}
function read(revision?: number) {
  const output = run(['read', id, ...(revision ? ['--revision', String(revision)] : [])]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  return { ...output, record: DecisionRecordSchema.parse(output.record) };
}
function action(operation: string, payload: unknown, revision = read().record.revision, project = 'p') {
  return run(['action', operation, id, actionId, '--expected-revision', String(revision), '--json', JSON.stringify(payload)], project);
}
function review(value = plan) { return action('review', { plan: value, reason: '依据新信息明确复核，范围不冒充已完成', origin: '作者复核' }); }
const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'decision-progress-')); db = new Database(join(directory, 'state.sqlite'));
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
  for (const migration of decisionMigrations) migration.up(db);
  const output = run(['create', '--json', JSON.stringify(remoteOfferModel())]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  id = DecisionRecordSchema.parse(output.record).id;
  run(['action', 'plan', id, '--expected-revision', '1', '--json', JSON.stringify(plan)]);
  const saved = read().record.actions?.[0]; if (!saved) throw new Error('Expected action'); actionId = saved.id;
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

it('reports partial progress repeatedly without completing scope, rebinds only by explicit review, and preserves each plan/report after reopen', () => {
  run(['recommend', id, '--expected-revision', '2', '--json', JSON.stringify(remoteOfferRecommendation(['b']))]);
  expect(read().actionStates).toMatchObject([{ state: 'planned', planStatus: 'current', continuation: 'open', planRevision: 1 }]);
  action('progress', progress);
  const first = read(); const report = first.record.actions?.[0]?.progressReports?.[0];
  expect(report).toMatchObject({ actualCost: '本次3分钟、0元', basedOnPlanRevision: 1, receivedAgainstInputRevision: 1, resultingInputRevision: 2, provenance });
  expect(first.record.actions?.[0]?.result).toBeUndefined();
  expect(first.actionStates).toMatchObject([{ state: 'reported_in_progress', planStatus: 'needs_review', continuation: 'review_required' }]);
  expect(first.recommendationStatus).toBe('needs_review');
  const model = first.record.model; const advice = first.record.recommendation;
  review({ ...plan, purpose: '第一处已问，继续核对第二处；不新增已发生成本' });
  expect(read().record.model).toEqual(model); expect(read().record.recommendation).toEqual(advice);
  expect(read().record.inputRevision).toBe(2);
  expect(read().actionStates).toMatchObject([{ planStatus: 'current', continuation: 'open', planRevision: 2 }]);
  action('progress', { ...progress, summary: '第二处已联系，仍等待书面回复', actualCost: '本次2分钟、0元' });
  db.close(); db = new Database(join(directory, 'state.sqlite'));
  expect(read().record.actions?.[0]?.progressReports).toHaveLength(2);
  expect(read().record.actions?.[0]?.progressReports?.map(r => r.basedOnPlanRevision)).toEqual([1, 2]);
  expect(read().record.actions?.[0]?.plan).toEqual(plan);
  expect(read(first.record.revision).record).toEqual(first.record);
  const before = rows(); const compared = run(['compare', id, '--from', String(first.record.revision), '--to', String(read().record.revision)]);
  expect(compared).toMatchObject({ actionChanges: { changed: [{ id: actionId }] } }); expect(rows()).toEqual(before);
});

it('invalidates an active plan after correction, rejects a withdrawn premise, and confirms a complete replacement without rewriting old plans', () => {
  action('progress', progress); const before = read();
  const input = before.record.model.inputs.find(i => i.id === 'a_remote'); if (!input) throw new Error('Expected input');
  run(['update', id, '--expected-revision', String(before.record.revision), '--json', JSON.stringify({ reason: '撤回错误确认', inputs: [{ ...input, value: true, status: 'withdrawn' }] })]);
  expect(read().actionStates).toMatchObject([{ planStatus: 'needs_review', unavailableInputIds: ['a_remote'] }]);
  expect(run(['compare', id, '--from', String(before.record.revision), '--to', String(read().record.revision)]))
    .toMatchObject({ actionChanges: { changed: [] }, actionStateChanges: { changed: [{ id: actionId, after: { unavailableInputIds: ['a_remote'] } }] } });
  const corrected = rows(); expect(() => review()).toThrow('Withdrawn action input'); expect(rows()).toEqual(corrected);
  review({ ...plan, label: '重新询问真实安排', purpose: '原确认已撤回，先探索当前可行安排', inputIds: [] });
  const saved = read(); expect(saved.actionStates).toMatchObject([{ planStatus: 'current', plan: { purpose: '原确认已撤回，先探索当前可行安排', inputIds: [] } }]);
  expect(saved.record.actions?.[0]?.plan).toEqual(plan);
  expect(saved.record.actions?.[0]?.progressReports).toEqual(before.record.actions?.[0]?.progressReports);
  expect(saved.record.model.inputs.find(i => i.id === 'a_remote')?.status).toBe('withdrawn');
  expect(() => run(['action', 'plan', id, '--expected-revision', String(saved.record.revision), '--json', JSON.stringify(plan)])).toThrow('Withdrawn action input');
});

it('withdraws a specific report, not other observations or costs, without reopening a final action', () => {
  action('progress', progress); action('progress', { ...progress, summary: '第二次观察', actualCost: '本次1分钟' });
  const before = read(); const reports = before.record.actions?.[0]?.progressReports; const first = reports?.[0];
  if (!first) throw new Error('Expected report');
  action('withdraw', { reportId: first.id, reason: '撤回错误转述，3分钟真实发生', origin: '合成用户更正' });
  let saved = read(); expect(saved.record.model).toEqual(before.record.model);
  expect(saved.record.actions?.[0]?.progressReports?.[0]).toMatchObject({ ...first, withdrawal: { reason: '撤回错误转述，3分钟真实发生' } });
  expect(saved.record.actions?.[0]?.progressReports?.[1]).toEqual(reports?.[1]);
  expect(saved.actionStates).toMatchObject([{ state: 'reported_in_progress', activeProgressReportIds: [reports?.[1]?.id], planStatus: 'needs_review' }]);
  review(); action('resolve', { outcome: 'completed', summary: '两处已全部核对', origin: '用户报告', actualCost: '本次2分钟、0元' });
  saved = read(); expect(saved.record.actions?.[0]?.result?.basedOnPlanRevision).toBe(2);
  expect(saved.actionStates).toMatchObject([{ state: 'reported_completed', planStatus: 'closed', continuation: 'closed' }]);
  const closed = rows(); expect(() => action('progress', progress)).toThrow('closed'); expect(() => review()).toThrow('closed'); expect(rows()).toEqual(closed);
  action('withdraw', { reason: '最终报告有误', origin: '用户更正' });
  expect(read().actionStates).toMatchObject([{ state: 'report_withdrawn', continuation: 'closed' }]);
  expect(() => action('progress', progress)).toThrow('closed'); expect(() => review()).toThrow('closed');
});

it('keeps a fully withdrawn progress history visible, allows late facts, and distinguishes stopping from completion', () => {
  action('progress', progress); const report = read().record.actions?.[0]?.progressReports?.[0]; if (!report) throw new Error('Expected report');
  action('withdraw', { reportId: report.id, reason: '报告错配', origin: '用户' });
  expect(read().actionStates).toMatchObject([{ state: 'progress_withdrawn', continuation: 'review_required' }]);
  // 待复核阻止把计划视为可接续，不阻止记录后来实际收到的事实。
  action('progress', { ...progress, summary: '后来实际取得的新观察' });
  action('resolve', { outcome: 'cancelled', summary: '明确停止余下范围，已花时间保留', origin: '用户决定', actualCost: '本次0分钟、0元' });
  expect(read().actionStates).toMatchObject([{ state: 'reported_cancelled', continuation: 'closed' }]);
  expect(read().record.actions?.[0]?.progressReports).toHaveLength(2);
});

it('rejects bad models, forged identity, missing/duplicate reports, stale versions and cross-project calls atomically', () => {
  const before = rows();
  expect(() => action('progress', { ...progress, update: { reason: '坏模型', checks: [{ id: 'bad', label: '坏引用', optionId: 'none', operator: 'is', inputId: 'a_remote', value: true }] } })).toThrow();
  expect(() => action('progress', { ...progress, provenance })).toThrow();
  expect(() => review({ ...plan, inputIds: ['a_remote', 'a_remote'] })).toThrow('repeat');
  expect(() => action('review', { reason: '空确认', origin: '作者' })).toThrow();
  expect(() => action('progress', progress, 1)).toThrow('Revision conflict');
  expect(() => action('progress', progress, 2, 'other')).toThrow('not found');
  expect(() => action('withdraw', { reportId: '00000000-0000-4000-8000-000000000001', reason: '不存在', origin: '用户' })).toThrow('No reported');
  expect(rows()).toEqual(before);
  action('progress', progress); const first = read().record.actions?.[0]?.progressReports?.[0]; if (!first) throw new Error('Expected report');
  action('withdraw', { reportId: first.id, reason: '更正', origin: '用户' }); const withdrawn = rows();
  expect(() => action('withdraw', { reportId: first.id, reason: '再次更正', origin: '用户' })).toThrow('already withdrawn'); expect(rows()).toEqual(withdrawn);
});

it('admits progress and review files with actual caller provenance and fails unbound quotes before writing', async () => {
  async function file(operation: string, payload: unknown, runId = 'synthetic-run') {
    const path = `${operation}.json`; writeFileSync(join(directory, path), JSON.stringify(payload));
    const prepared = decisionPluginCli.prepare({ argv: ['action', operation, id, actionId, '--expected-revision', String(read().record.revision), '--input', path], conversationRoot: directory, invocationId: operation });
    if (prepared.status !== 'ready') throw new Error('Expected plan');
    return prepared.plan.execute({ projectId: 'p', conversationId: 'synthetic', agentRunId: runId, hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal });
  }
  expect((await file('progress', progress)).exitCode).toBe(0);
  const before = rows(); expect((await file('review', { plan, reason: '明确复核', origin: '作者', sourceQuote: '伪造原句' }, '')).exitCode).toBe(3); expect(rows()).toEqual(before);
  expect((await file('review', { plan, reason: '作者按现有资料复核', origin: '作者' })).exitCode).toBe(0);
  expect(read().record.actions?.[0]?.reviews?.[0]?.provenance).toEqual(provenance);
  expect(read().actionStates).toMatchObject([{ planStatus: 'current' }]);
});
