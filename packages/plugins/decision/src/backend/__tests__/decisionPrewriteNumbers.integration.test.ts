import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DecisionModel, DecisionRecommendation } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { refundableOrderModel } from './fixtures/refundableOrder';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
  for (const migration of decisionMigrations) migration.up(db);
});
afterEach(() => db.close());
function run(args: string[]) {
  const command = parseDecisionCli(args);
  if (command.kind === 'file') throw new Error('Expected inline command');
  return executeDecisionCommand(command, db, 'p');
}
function create(model: DecisionModel) {
  const output = run(['create', '--json', JSON.stringify(model)]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  return output;
}
function check(id: string, revision: number, optionIds = ['b']) {
  const output = run(['check', id, '--expected-revision', String(revision), '--json', JSON.stringify({ optionIds })]);
  if (typeof output !== 'object' || output === null || !('kind' in output) || output.kind !== 'option_check') throw new Error('Expected check preview');
  return output;
}
function read(id: string, revision?: number) {
  const output = run(['read', id, ...(revision ? ['--revision', String(revision)] : [])]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  return output;
}
function timeModel(): DecisionModel {
  return {
    title: '合成讲座时间', question: '先取得边界和同点算值再写计划',
    inputs: [
      { id: 'start', label: '出发时刻', kind: 'fact', value: 510, unit: '当天00:00起分钟', origin: '合成输入', status: 'available' },
      { id: 'travel', label: '路程', kind: 'fact', value: 45, unit: '分钟', origin: '合成输入', status: 'available' },
      { id: 'event', label: '开场时刻', kind: 'fact', value: 570, unit: '当天00:00起分钟', origin: '合成输入', status: 'available' },
      { id: 'access', label: '入场许可', kind: 'fact', value: true, origin: '合成输入', status: 'available' },
    ],
    options: [{ id: 'b', label: 'B讲座', description: '合成现场讲座' }],
    calculations: [{ id: 'arrival', label: 'B到场时刻', unit: '当天00:00起分钟', expression: { op: 'add', left: { input: 'start' }, right: { input: 'travel' } } }],
    checks: [
      { id: 'on_time', optionId: 'b', label: '准时到场', left: { op: 'add', left: { input: 'start' }, right: { input: 'travel' } }, operator: 'lte', right: { input: 'event' } },
      { id: 'permission', optionId: 'b', label: '入场确认', operator: 'is', inputId: 'access', value: true },
    ],
  };
}

it('previews before any advice or plan, then generates the same numeric conditions alongside qualitative author text', () => {
  const { record } = create(timeModel());
  const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
  const before = rows();
  const preview = check(record.id, 1);
  expect(preview.persisted).toBe(false); expect(rows()).toEqual(before);
  expect(read(record.id).record.recommendation).toBeNull(); expect(read(record.id).record.actions).toBeUndefined();
  const departure = preview.numericPreview.boundaries.find(item => item.inputId === 'start');
  expect(departure?.text).toContain('≤ 525');
  expect(departure?.text).toContain('出发时刻 = 525');
  expect(departure?.text).toContain('B到场时刻：570');
  expect(preview.numericPreview.calculations[0]?.result).toEqual({ status: 'available', value: 555 });
  expect(preview.numericPreview.inputs.find(item => item.id === 'start')?.value).toBe(510);
  expect(preview.numericBasis.boundaries.some(item => item.checkId === 'permission')).toBe(false);
  const advice: DecisionRecommendation = {
    optionIds: ['b'], rationale: '许可与时间允许后按偏好选择', changeConditions: '许可或偏好变化时复核',
    nextAction: '核对实际出发安排', unresolved: [], numericBasis: preview.numericBasis,
  };
  run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice)]);
  const saved = read(record.id);
  if (saved.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
  expect(saved.recommendationBasis.changeConditions).toEqual(preview.numericPreview.changeConditions);
  expect(saved.recommendationBasis.boundaries).toEqual(preview.numericPreview.boundaries);
  expect(saved.record.recommendation?.content.changeConditions).toBe(advice.changeConditions);
  expect(saved.record.revision).toBe(2); expect(saved.record.inputRevision).toBe(1);
});

it('previews the current model while keeping old advice stale, its historical numbers unchanged and the database read-only', () => {
  const { record } = create(timeModel()); const first = check(record.id, 1);
  run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify({ optionIds: ['b'], rationale: '按已知条件选择', changeConditions: '许可变化时复核', nextAction: '核对许可', unresolved: [], numericBasis: first.numericBasis })]);
  const start = record.model.inputs.find(item => item.id === 'start'); if (!start) throw new Error('Missing input');
  run(['update', record.id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '起点变化', inputs: [{ ...start, value: 526 }] })]);
  const before = db.prepare('SELECT * FROM decision_record_versions').all(); const current = check(record.id, 3);
  expect(current.overall).toBe('blocked'); expect(current.numericPreview.calculations[0]?.result).toEqual({ status: 'available', value: 571 });
  expect(current.numericPreview.basedOnRevision).toBe(3); expect(current.numericPreview.basedOnInputRevision).toBe(2);
  expect(read(record.id).recommendationBasis).toEqual({ status: 'needs_review', basedOnInputRevision: 1 });
  const historical = read(record.id, 2);
  if (historical.recommendationBasis?.status !== 'current') throw new Error('Expected historical basis');
  expect(historical.recommendationBasis.calculations[0]?.result).toEqual({ status: 'available', value: 555 });
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});

it('keeps unknown and withdrawn values unavailable and does not turn discrete or nonlinear checks into fake numeric points', () => {
  const model = timeModel(); model.inputs = model.inputs.map(item => item.id === 'start' || item.id === 'access' ? { ...item, value: null } : item);
  const { record } = create(model); const unknown = check(record.id, 1);
  expect(unknown.overall).toBe('undetermined'); expect(unknown.numericPreview.calculations[0]?.result.status).toBe('unavailable');
  expect(unknown.numericPreview.boundaries.find(item => item.inputId === 'start')?.atBoundary?.calculations[0]?.result).toEqual({ status: 'available', value: 570 });
  const start = model.inputs.find(item => item.id === 'start'); if (!start) throw new Error('Missing input');
  run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '撤回起点', inputs: [{ ...start, status: 'withdrawn' }] })]);
  expect(check(record.id, 2).numericPreview.boundaries.find(item => item.inputId === 'start')?.atBoundary).toBeNull();
  const nonlinear = timeModel(); nonlinear.checks = [{ id: 'square', optionId: 'b', label: '非线性条件', left: { op: 'multiply', left: { input: 'start' }, right: { input: 'start' } }, operator: 'lte', right: { literal: 1000 } }];
  const another = create(nonlinear); const projected = check(another.record.id, 1);
  expect(projected.numericPreview.boundaries[0]?.result.status).toBe('unavailable'); expect(projected.numericPreview.boundaries[0]?.atBoundary).toBeNull();
});

it('delivers money boundary and point values through the real bridge before a recommendation exists, even when the current option fails', async () => {
  const model = refundableOrderModel(); model.inputs = model.inputs.map(item => item.id === 'extra_fees' ? { ...item, value: 600 } : item);
  const { record } = create(model);
  const prepared = decisionPluginCli.prepare({ argv: ['check', record.id, '--expected-revision', '1', '--json', '{"optionIds":["proceed","wait"]}'], conversationRoot: '/unused', invocationId: 'prewrite' });
  if (prepared.status !== 'ready') throw new Error('Expected admitted check'); expect(prepared.plan.access.conversationFiles).toBe('none');
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const reply = await prepared.plan.execute({ conversationId: 'c', agentRunId: 'r', projectId: 'p', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal });
  expect(reply.exitCode).toBe(0); const returned: unknown = JSON.parse(reply.stdout);
  const preview = check(record.id, 1, ['proceed', 'wait']); expect(returned).toEqual(JSON.parse(JSON.stringify(preview)));
  const point = preview.numericPreview.boundaries.find(item => item.inputId === 'extra_fees');
  expect(point?.text).toContain('全部附加费 = 520'); expect(point?.text).toContain('：1000 CNY/全程'); expect(point?.text).toContain('：-510 CNY/本批');
  expect(preview.numericPreview.calculations.find(item => item.id === 'incremental_gap')?.result).toEqual({ status: 'available', value: -590 });
  expect(read(record.id).record.recommendation).toBeNull(); expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});
