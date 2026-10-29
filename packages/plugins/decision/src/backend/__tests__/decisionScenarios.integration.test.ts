import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecisionExpression, DecisionModel } from '../../shared';
import { DecisionRecordSchema } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { simulateDecisionScenarios } from '../features/decision-record/functions/simulateDecisionScenarios';

const input = (id: string): DecisionExpression => ({ input: id });
const add = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'add', left, right });
function model(): DecisionModel {
  return {
    title: '假想课程', question: '预算与到场约束下选课',
    inputs: [
      ['budget', 2200], ['a_cost', 2160], ['b_base', 2196], ['b_book', 0],
      ['departure', 1050], ['a_travel', 40], ['b_travel', 25], ['a_start', 1110], ['b_start', 1125],
    ].map(([id, value]) => ({ quantityType: 'other', id: String(id), label: String(id), kind: 'fact', value: Number(value), origin: '合成夹具', status: 'available' })),
    options: [{ id: 'A', label: 'A', description: '条件满足时偏好A' }, { id: 'B', label: 'B', description: '备选B' }],
    // 模仿实际失败：b_book登记了但未接入公式，试算应揭露它而不是自动补公式。
    calculations: [{ quantityType: 'money', id: 'b_total', label: 'B总价', unit: 'CNY/期', expression: input('b_base') }],
    checks: [
      { id: 'a_budget', optionId: 'A', label: 'A预算', left: input('a_cost'), operator: 'lte', right: input('budget') },
      { id: 'b_budget', optionId: 'B', label: 'B预算', left: input('b_base'), operator: 'lte', right: input('budget') },
      { id: 'a_time', optionId: 'A', label: 'A准时', left: add(input('departure'), input('a_travel')), operator: 'lte', right: input('a_start') },
      { id: 'b_time', optionId: 'B', label: 'B准时', left: add(input('departure'), input('b_travel')), operator: 'lte', right: input('b_start') },
    ],
  };
}
const scenario = (id: string, inputId: string, value: number | null | string) => ({ id, label: id, inputs: [{ inputId, value }] });

describe('read-only counterfactuals through project CLI and SQLite', () => {
  let db: Database.Database;
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-scenarios-'));
    db = new Database(path.join(directory, 'state.sqlite'));
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
    for (const migration of decisionMigrations) migration.up(db);
  });
  afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function run(argv: readonly string[], project = 'p') {
    const command = parseDecisionCli(argv);
    if (command.kind === 'file') throw new Error('Use the admitted bridge for file payloads');
    return executeDecisionCommand(command, db, project);
  }
  function read(id: string) {
    const result = run(['read', id]);
    if (typeof result !== 'object' || result === null || !('record' in result)) throw new Error('Expected a record');
    return DecisionRecordSchema.parse(result.record);
  }
  function create(source = model()) {
    const result = run(['create', '--json', JSON.stringify(source)]);
    if (typeof result !== 'object' || result === null || !('record' in result)) throw new Error('Expected a record');
    return DecisionRecordSchema.parse(result.record);
  }
  function simulate(id: string, revision: number, cases: ReturnType<typeof scenario>[], project = 'p') {
    const result = run(['simulate', id, '--expected-revision', String(revision), '--json', JSON.stringify({ cases })], project);
    const expected = simulateDecisionScenarios(read(id), revision, { cases });
    expect(result).toEqual(expected);
    return expected;
  }

  it('exposes an unused fee input and only changes the result after an explicit real model repair', () => {
    const record = create();
    const before = db.prepare('SELECT * FROM decision_record_versions').all();
    const result = simulate(record.id, 1, [scenario('fee5', 'b_book', 5)]);
    expect(result.cases[0]?.unreferencedInputIds).toEqual(['b_book']);
    expect(result.cases[0]?.evaluation.calculations[0]?.result).toEqual({ status: 'available', value: 2196 });
    expect(read(record.id)).toEqual(record);
    expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
    const expression = add(input('b_base'), input('b_book'));
    run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '教材另收需要纳入费用式',
      calculations: [{ ...record.model.calculations[0], expression }],
      checks: record.model.checks.map(check => check.id === 'b_budget' ? { ...check, left: expression } : check),
    })]);
    const fixed = simulate(record.id, 2, [scenario('fee5', 'b_book', 5), scenario('fee4', 'b_book', 4)]);
    expect(fixed.cases.map(item => item.unreferencedInputIds)).toEqual([[], []]);
    expect(fixed.cases.map(item => item.evaluation.calculations[0]?.result)).toEqual([
      { status: 'available', value: 2201 }, { status: 'available', value: 2200 },
    ]);
    expect(fixed.cases.map(item => item.evaluation.checks.find(check => check.id === 'b_budget')?.passes)).toEqual([false, true]);
    expect(read(record.id).revision).toBe(2);
  });

  it('reevaluates both options for shared inputs, includes equality, and starts every case from the same base', () => {
    const record = create();
    const result = simulate(record.id, 1, [
      scenario('both_late', 'departure', 1101), scenario('a_exact', 'departure', 1070), scenario('only_fee', 'b_base', 2201),
    ]);
    const time = (index: number) => result.cases[index]?.evaluation.checks.filter(check => check.id.endsWith('time')).map(check => check.passes);
    expect(time(0)).toEqual([false, false]);
    expect(time(1)).toEqual([true, true]);
    expect(time(2)).toEqual([true, true]);
    expect(result.cases[2]?.evaluation.checks.find(check => check.id === 'b_budget')?.passes).toBe(false);
    expect(read(record.id)).toEqual(record);
  });

  it('preserves unknown, withdrawn and qualitative inputs without inventing a zero or a numeric effect', () => {
    const source = model();
    source.inputs.push({ quantityType: 'other', id: 'preference', label: '偏好', kind: 'preference', value: 'A', status: 'available', origin: '用户明确偏好' });
    source.inputs = source.inputs.map(item => item.id === 'b_base' ? { ...item, status: 'withdrawn' } : item);
    const record = create(source);
    const result = simulate(record.id, 1, [scenario('unknown_budget', 'budget', null), scenario('withdrawn', 'b_base', 10), scenario('new_preference', 'preference', 'B')]);
    expect(result.cases[0]?.evaluation.checks.find(check => check.id === 'a_budget')?.passes).toBeNull();
    expect(result.cases[1]?.evaluation.calculations[0]?.result.status).toBe('unavailable');
    expect(result.cases[2]?.unreferencedInputIds).toEqual(['preference']);
    expect(result.cases[2]?.changes[0]?.to).toBe('B');
    expect(read(record.id)).toEqual(record);
  });

  it('rejects missing/colliding identities, stale versions and cross-project access without appending versions', () => {
    const record = create();
    for (const cases of [
      [scenario('bad', 'missing', 1)],
      [scenario('duplicate', 'budget', 1), scenario('duplicate', 'budget', 2)],
      [{ ...scenario('bad', 'budget', 1), inputs: [{ inputId: 'budget', value: 1 }, { inputId: 'budget', value: 2 }] }],
    ]) expect(() => simulate(record.id, 1, cases)).toThrow();
    expect(() => simulate(record.id, 2, [scenario('bad', 'budget', 1)])).toThrow('Revision conflict');
    expect(() => simulate(record.id, 1, [scenario('bad', 'budget', 1)], 'other')).toThrow('not found');
    expect(read(record.id)).toEqual(record);
  });

  it('accepts conversation file payloads through the bridge while leaving the file, record and recommendation untouched', async () => {
    const record = create();
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify({ optionIds: ['A'], rationale: '用户偏好且当前可行', changeConditions: '条件变化后比较', nextAction: '核对日程', unresolved: [] })]);
    const before = read(record.id);
    const content = JSON.stringify({ cases: [scenario('late', 'departure', 1101)] });
    fs.writeFileSync(path.join(directory, 'cases.json'), content);
    const prepared = decisionPluginCli.prepare({ argv: ['simulate', record.id, '--expected-revision', '2', '--input', 'cases.json'], conversationRoot: directory, invocationId: 'counterfactual' });
    if (prepared.status !== 'ready') throw new Error('Expected a ready plan');
    const reply = await prepared.plan.execute({ conversationId: 'synthetic', projectId: 'p', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
    expect(reply.exitCode).toBe(0);
    const output: unknown = JSON.parse(reply.stdout);
    expect(output).toEqual(simulateDecisionScenarios(before, 2, { cases: [scenario('late', 'departure', 1101)] }));
    expect(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8')).toBe(content);
    expect(read(record.id)).toEqual(before);
    const inline = decisionPluginCli.prepare({ argv: ['simulate', record.id, '--expected-revision', '2', '--json', content], conversationRoot: directory, invocationId: 'inline' });
    if (inline.status !== 'ready') throw new Error('Expected a ready plan');
    expect(inline.plan.access.conversationFiles).toBe('none');
  });
});
