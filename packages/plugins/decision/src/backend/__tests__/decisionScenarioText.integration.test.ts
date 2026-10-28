import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DecisionModel, DecisionRecommendation } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { createDecisionRecordRepository } from '../features/decision-record';

let db: Database.Database;
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-scenario-text-'));
  db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
  for (const migration of decisionMigrations) migration.up(db);
});
afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function run(argv: string[]) {
  const command = parseDecisionCli(argv);
  if (command.kind === 'file') throw new Error('Inline expected');
  return executeDecisionCommand(command, db, 'p');
}
function create(model?: DecisionModel) {
  const source: DecisionModel = model ?? {
    title: '合成到场情景', question: '变更出发点后仍须匹配同点到场',
    inputs: [
      { id: 'start', label: '出发时刻', kind: 'fact', value: 510, unit: '当天00:00起分钟', origin: '合成输入', status: 'available' },
      { id: 'travel', label: '路程', kind: 'fact', value: 45, unit: '分钟', origin: '合成输入', status: 'available' },
    ],
    options: [{ id: 'b', label: 'B', description: '合成现场' }],
    calculations: [{ id: 'arrival', label: 'B到场', unit: '当天00:00起分钟', expression: { op: 'add', left: { input: 'start' }, right: { input: 'travel' } } }],
    checks: [{ id: 'time', optionId: 'b', label: '准时', left: { op: 'add', left: { input: 'start' }, right: { input: 'travel' } }, operator: 'lte', right: { literal: 570 } }],
  };
  const output = run(['create', '--json', JSON.stringify(source)]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Record expected');
  return output.record;
}
function advice(label: string, nextAction: string, value: number | null = 525): DecisionRecommendation {
  return { optionIds: ['b'], rationale: '采用同点判断', changeConditions: '条件变化时复核', nextAction: '核对安排', unresolved: [],
    conditionalAdvice: { cases: [{ id: 'late', label, inputs: [{ inputId: 'start', value }], nextAction }],
      whenNonePass: '另找安排', whenUndetermined: '补充资料' } };
}
async function bridge(argv: string[]) {
  const prepared = decisionPluginCli.prepare({ argv, conversationRoot: directory, invocationId: 'scenario' });
  if (prepared.status !== 'ready') throw new Error('Admission expected');
  return prepared.plan.execute({ conversationId: 'c', agentRunId: 'r', projectId: 'p', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal });
}

it('rejects the confirmed 08:45→09:15 splice atomically and the next corrected submission succeeds', async () => {
  const record = create(); const content = advice('08:45才出发', '直接走B，09:15到场');
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const args = ['recommend', record.id, '--expected-revision', '1', '--json'];
  const failed = await bridge([...args, JSON.stringify(content)]);
  expect(failed.exitCode).toBe(3);
  expect(failed.stderr).toContain('scenario_text_mismatch'); expect(failed.stderr).toContain('scenario late');
  expect(failed.stderr).toContain('555（09:15）'); expect(failed.stderr).toContain('570（09:30）');
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
  expect(createDecisionRecordRepository(db, 'p').read(record.id).recommendation).toBeNull();
  const fixed = await bridge([...args, JSON.stringify(advice('08:45才出发', '直接走B，09:30到场'))]);
  expect(fixed.exitCode).toBe(0); expect(createDecisionRecordRepository(db, 'p').read(record.id).revision).toBe(2);
});

it('checks both labels and actions while permitting an explicit baseline-to-scenario comparison', () => {
  const record = create();
  expect(() => run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice('08:30出发', '到场改为570'))])).toThrow('input start');
  run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice('从08:30改成08:45', '原来09:15到，本情景09:30到'))]);
  expect(createDecisionRecordRepository(db, 'p').read(record.id).revision).toBe(2);
});

it('does not truncate decimals or match integer substrings, and skips unavailable or unchanged values', () => {
  for (const content of [advice('稍晚出发', '资料编号1555，估算6.01'), advice('仍是基线', '09:15到场', 510), advice('起点未知', '09:15是原计划', null)]) {
    const record = create();
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(content)]);
    expect(createDecisionRecordRepository(db, 'p').read(record.id).revision).toBe(2);
  }
  const record = create();
  run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice('小数分钟情景', '原来的09:15仅作参考', 525.5))]);
  expect(createDecisionRecordRepository(db, 'p').read(record.id).revision).toBe(2);
});

it('leaves amounts, counts and durations outside the clock-only guard, without checking other advice fields', () => {
  const base = create();
  for (const unit of ['CNY', '人', '分钟', undefined]) {
    const model: DecisionModel = { ...base.model,
      inputs: [{ id: 'start', label: '登记值', kind: 'fact', value: 6, unit, origin: '合成', status: 'available' }],
      calculations: [], checks: [] };
    const record = create(model);
    const content = { ...advice('情景为7', '建议调整回6', 7), rationale: '其他字段1000未核', changeConditions: '其他条件1000未核', nextAction: '顶层1000不在覆盖范围' };
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(content)]);
    expect(createDecisionRecordRepository(db, 'p').read(record.id).recommendation?.content).toEqual(content);
  }
});

it('does not reject a legitimate decimal or scientific example by taking integers from inside its token', () => {
  const base = create();
  for (const baseline of [0, 6, 555]) {
    const record = create({ ...base.model, inputs: [{ id: 'start', label: '登记时刻', kind: 'fact', value: baseline, unit: '当天00:00起分钟', origin: '合成', status: 'available' }], calculations: [], checks: [] });
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice('比例说明', '小数.6、-.6、6.01和指数6e-3、1e-555不代表本情景数量', 8))]);
    expect(createDecisionRecordRepository(db, 'p').read(record.id).revision).toBe(2);
  }
});

it('leaves historical mismatched advice readable and exportable rather than re-validating it on read', () => {
  const record = create(); const repository = createDecisionRecordRepository(db, 'p');
  repository.append({ ...record, revision: 2, recommendation: { basedOnInputRevision: 1, content: advice('08:45出发', '09:15到场') } }, 1);
  expect(() => run(['read', record.id])).not.toThrow();
  expect(() => run(['export', record.id, '--expected-revision', '2'])).not.toThrow();
  expect(repository.read(record.id).recommendation?.content.conditionalAdvice?.cases?.[0]?.nextAction).toBe('09:15到场');
});

it('delivers compact/full checks through file and inline CLI without changing the record', async () => {
  const record = create(); const args = ['check', record.id, '--expected-revision', '1'];
  fs.writeFileSync(path.join(directory, 'check.json'), '{"optionIds":["b"]}');
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const compact = await bridge([...args, '--json', '{"optionIds":["b"]}']);
  const full = await bridge([...args, '--input', 'check.json', '--full']);
  const compactFile = await bridge([...args, '--input', 'check.json']);
  const fullInline = await bridge([...args, '--json', '{"optionIds":["b"]}', '--full']);
  expect(compact.exitCode).toBe(0); expect(full.exitCode).toBe(0);
  expect(compactFile).toEqual(compact); expect(fullInline).toEqual(full);
  const small: unknown = JSON.parse(compact.stdout); const large: unknown = JSON.parse(full.stdout);
  if (typeof small !== 'object' || small === null || !('changeConditions' in small) || !('calculations' in small)
    || typeof large !== 'object' || large === null || !('numericPreview' in large)) throw new Error('Expected check variants');
  expect(compact.stdout).toContain('525（08:45）'); expect(compact.stdout).toContain('570（09:30）');
  expect('numericPreview' in small).toBe(false); expect(compact.stdout.length).toBeLessThan(full.stdout.length / 2);
  expect(small).toMatchObject({ overall: 'declared_checks_pass', persisted: false, authorization: 'not_evaluated' });
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});
