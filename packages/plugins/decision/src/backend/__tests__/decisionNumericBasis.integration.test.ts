import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DecisionRecordSchema, type DecisionExpression, type DecisionModel,
} from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { projectDecisionRecord } from '../features/decision-record';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';

const input = (id: string): DecisionExpression => ({ input: id });
const literal = (value: number): DecisionExpression => ({ literal: value });
const add = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'add', left, right });
const subtract = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'subtract', left, right });
const multiply = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'multiply', left, right });
const divide = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'divide', left, right });
const cost = (prefix: string) => add(add(input(`${prefix}_tuition`), input(`${prefix}_materials`)), multiply(input('sessions'), input(`${prefix}_transport`)));

function courseModel(): DecisionModel {
  const numbers = [
    ['budget', '预算', 2200, 'CNY/期'], ['sessions', '总课次', 8, '次/期'],
    ['departure', '出发时刻（18:00为0）', 0, '分钟'],
    ['a_tuition', 'A学费', 1800, 'CNY/期'], ['a_materials', 'A教材', 200, 'CNY/期'],
    ['a_transport', 'A单次去程费用', 20, 'CNY/次'], ['a_commute', 'A去程用时', 40, '分钟'], ['a_start', 'A开课（18:00为0）', 30, '分钟'],
    ['b_tuition', 'B学费', 2100, 'CNY/期'], ['b_materials', 'B教材', 0, 'CNY/期'],
    ['b_transport', 'B单次去程费用', 12, 'CNY/次'], ['b_commute', 'B去程用时', 25, '分钟'], ['b_start', 'B开课（18:00为0）', 45, '分钟'],
  ] as const;
  return {
    title: '合成课程边界', question: '预算与准时约束下比较两门课',
    inputs: numbers.map(([id, label, value, unit]) => ({ quantityType: 'other', id, label, value, unit, kind: 'fact', origin: '合成业务夹具', status: 'available' })),
    options: [{ id: 'A', label: 'A', description: '内容偏好A' }, { id: 'B', label: 'B', description: '另一课程' }],
    calculations: ['a', 'b'].flatMap(prefix => [
      { quantityType: 'money', id: `${prefix}_cost`, label: `${prefix}一期总费用`, unit: 'CNY/期', expression: cost(prefix) },
      { quantityType: 'duration', id: `${prefix}_buffer`, label: `${prefix}开课减到场的余量`, unit: '分钟', expression: subtract(input(`${prefix}_start`), add(input('departure'), input(`${prefix}_commute`))) },
    ]),
    checks: ['a', 'b'].flatMap(prefix => [
      { id: `${prefix}_budget`, optionId: prefix.toUpperCase(), label: `${prefix}费用不超预算`, left: cost(prefix), operator: 'lte', right: input('budget') },
      { id: `${prefix}_time`, optionId: prefix.toUpperCase(), label: `${prefix}准时到场`, left: add(input('departure'), input(`${prefix}_commute`)), operator: 'lte', right: input(`${prefix}_start`) },
    ]),
  };
}

const advice = (option: string, calculationIds: string[], boundaries: { checkId: string; inputId: string }[]) => ({
  optionIds: [option], rationale: '结合已声明的预算、时间与偏好比较',
  changeConditions: '数值约束失效时重新判断，其他取舍仍需核实', nextAction: '确认费用范围', unresolved: [],
  numericBasis: { calculationIds, boundaries },
});

describe('recommendation numerical basis through CLI and persistent versions', () => {
  let db: Database.Database;
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-boundary-'));
    db = new Database(path.join(directory, 'state.sqlite'));
    db.pragma('foreign_keys = ON');
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations) migration.up(db);
  });
  afterEach(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  function command(argv: readonly string[]) {
    const parsed = parseDecisionCli(argv);
    if (parsed.kind === 'file') throw new Error('Use the admitted file transport for file payloads.');
    const result = executeDecisionCommand(parsed, db, 'p');
    if (typeof result !== 'object' || result === null || !('record' in result)) throw new Error('Expected a record projection');
    const view = projectDecisionRecord(DecisionRecordSchema.parse(result.record));
    expect(result).toEqual(view);
    return view;
  }
  const create = (model = courseModel()) => command(['create', '--json', JSON.stringify(model)]);
  function recommend(id: string, revision: number, content: ReturnType<typeof advice>) {
    return command(['recommend', id, '--expected-revision', String(revision), '--json', JSON.stringify(content)]);
  }
  function update(id: string, revision: number, change: object) {
    return command(['update', id, '--expected-revision', String(revision), '--json', JSON.stringify({ reason: '测试条件变化', ...change })]);
  }

  it('derives budget thresholds with units and preserves the inclusive boundary before rejecting overspend', () => {
    const { record } = create();
    const result = recommend(record.id, 1, advice('B', ['a_cost', 'b_cost'], [
      { checkId: 'b_budget', inputId: 'b_tuition' }, { checkId: 'b_budget', inputId: 'b_transport' },
    ]));
    expect(result.recommendationBasis?.status).toBe('current');
    if (result.recommendationBasis?.status !== 'current') throw new Error('Expected current numerical basis');
    expect(result.recommendationBasis.calculations.map(item => item.result)).toEqual([
      { status: 'available', value: 2160 }, { status: 'available', value: 2196 },
    ]);
    expect(result.recommendationBasis.boundaries.map(item => [item.unit, item.result])).toEqual([
      ['CNY/期', { status: 'available', operator: 'lte', value: 2104 }],
      ['CNY/次', { status: 'available', operator: 'lte', value: 12.5 }],
    ]);
    expect(result.recommendationBasis.boundaries[0]?.text).toContain('≤ 2104 CNY/期');
    expect(result.recommendationBasis.boundaries[0]?.text).toContain('> 2104 CNY/期');
    const tuition = courseModel().inputs.find(item => item.id === 'b_tuition');
    if (!tuition) throw new Error('Fixture missing tuition');
    const atLimit = update(record.id, 2, { inputs: [{ ...tuition, value: 2104 }] });
    expect(atLimit.evaluation.checks.find(item => item.id === 'b_budget')?.passes).toBe(true);
    const aboveLimit = update(record.id, 3, { inputs: [{ ...tuition, value: 2104.01 }] });
    expect(aboveLimit.evaluation.checks.find(item => item.id === 'b_budget')?.passes).toBe(false);
    expect(() => recommend(record.id, 4, advice('B', [], []))).toThrow('violates');
    expect(command(['read', record.id]).record.revision).toBe(4);
  });

  it('recomputes after departure changes, withholds stale numerical advice and retains the historical basis after reopen', () => {
    const { record } = create();
    recommend(record.id, 1, advice('B', ['b_buffer'], [{ checkId: 'b_time', inputId: 'departure' }]));
    const departure = courseModel().inputs.find(item => item.id === 'departure');
    if (!departure) throw new Error('Fixture missing departure');
    const changed = update(record.id, 2, { inputs: [{ ...departure, value: -30 }] });
    expect(changed.recommendationBasis).toEqual({ status: 'needs_review', basedOnInputRevision: 1 });
    const selected = recommend(record.id, 3, advice('A', ['a_buffer'], [{ checkId: 'a_time', inputId: 'departure' }]));
    if (selected.recommendationBasis?.status !== 'current') throw new Error('Expected current numerical basis');
    expect(selected.recommendationBasis.boundaries[0]?.result).toEqual({ status: 'available', operator: 'lte', value: -10 });
    expect(selected.recommendationBasis.calculations[0]?.result).toEqual({ status: 'available', value: 20 });
    db.close(); db = new Database(path.join(directory, 'state.sqlite'));
    expect(command(['read', record.id])).toEqual(selected);
    const history = command(['read', record.id, '--revision', '2']);
    if (history.recommendationBasis?.status !== 'current') throw new Error('Expected historical numerical basis');
    expect(history.recommendationBasis.boundaries[0]?.result).toEqual({ status: 'available', operator: 'lte', value: 20 });
    expect(update(record.id, 4, { inputs: [{ ...departure, value: -10 }] }).evaluation.checks.find(item => item.id === 'a_time')?.passes).toBe(true);
    expect(update(record.id, 5, { inputs: [{ ...departure, value: -9 }] }).evaluation.checks.find(item => item.id === 'a_time')?.passes).toBe(false);
  });

  it('rejects dangling or unrelated basis references without saving, and invalidates removed calculations', () => {
    const { record } = create();
    for (const content of [
      advice('B', ['absent'], []), advice('B', [], [{ checkId: 'absent', inputId: 'budget' }]),
      advice('B', [], [{ checkId: 'b_budget', inputId: 'absent' }]),
      advice('B', [], [{ checkId: 'b_budget', inputId: 'departure' }]),
    ]) expect(() => recommend(record.id, 1, content)).toThrow('Unknown or unrelated');
    expect(command(['read', record.id]).record.revision).toBe(1);
    recommend(record.id, 1, advice('B', ['b_cost'], []));
    const updated = update(record.id, 2, { calculations: [] });
    expect(updated.recommendationBasis?.status).toBe('needs_review');
    expect(() => recommend(record.id, 3, advice('B', ['b_cost'], []))).toThrow('Unknown or unrelated');
    expect(() => recommend(record.id, 1, advice('B', [], []))).toThrow('Revision conflict');
  });

  it('keeps unknown and withdrawn evidence unavailable instead of turning it into a numeric threshold', () => {
    const model = courseModel();
    model.inputs = model.inputs.map(item => item.id === 'budget' ? { ...item, value: null } : item);
    const { record } = create(model);
    const result = recommend(record.id, 1, advice('B', ['b_cost'], [{ checkId: 'b_budget', inputId: 'b_tuition' }]));
    if (result.recommendationBasis?.status !== 'current') throw new Error('Expected a current, conditional recommendation');
    expect(result.recommendationBasis.boundaries[0]?.result.status).toBe('unavailable');
    const budget = model.inputs.find(item => item.id === 'budget');
    if (!budget) throw new Error('Fixture missing budget');
    update(record.id, 2, { inputs: [{ ...budget, value: 2200, status: 'withdrawn' }] });
    const withdrawn = recommend(record.id, 3, advice('B', [], [{ checkId: 'b_budget', inputId: 'budget' }]));
    if (withdrawn.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
    expect(withdrawn.recommendationBasis.boundaries[0]?.result.status).toBe('unavailable');
  });

  it('handles reverse inequality, equality and cancellation, and refuses nonlinear estimates', () => {
    const model: DecisionModel = {
      title: '合成融资约束', question: '收入覆盖支出并保留已知约束',
      inputs: [{ quantityType: 'money', id: 'income', label: '收入', kind: 'assumption', value: 30, unit: 'CNY', status: 'available', origin: '合成假设' }],
      options: [{ id: 'plan', label: '计划', description: '合成计划' }], calculations: [],
      checks: [
        { id: 'surplus', optionId: 'plan', label: '结余非负', left: subtract(literal(50), input('income')), operator: 'lte', right: literal(20) },
        { id: 'exact', optionId: 'plan', label: '金额一致', left: input('income'), operator: 'eq', right: literal(30) },
        { id: 'constant', optionId: 'plan', label: '抵消后无关', left: subtract(input('income'), input('income')), operator: 'lte', right: literal(0) },
        { id: 'squared', optionId: 'plan', label: '非线性示例', left: multiply(input('income'), input('income')), operator: 'lte', right: literal(1000) },
        { id: 'inverse', optionId: 'plan', label: '倒数示例', left: divide(literal(1), input('income')), operator: 'gte', right: literal(0.01) },
      ],
    };
    const { record } = create(model);
    const result = recommend(record.id, 1, advice('plan', [], model.checks.map(check => ({ checkId: check.id, inputId: 'income' }))));
    if (result.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
    expect(result.recommendationBasis.boundaries.slice(2).every(item => item.atBoundary === null)).toBe(true);
    expect(result.recommendationBasis.boundaries.map(item => item.result)).toEqual([
      { status: 'available', operator: 'gte', value: 30 },
      { status: 'available', operator: 'eq', value: 30 },
      { status: 'independent', passes: true },
      { status: 'unavailable', reason: expect.stringContaining('Nonlinear') },
      { status: 'unavailable', reason: expect.stringContaining('denominator') },
    ]);
  });

  it('delivers the program basis through an admitted file command without certifying free author text', async () => {
    const { record } = create();
    // 保留旧错误作反例：结构化投影不能假装已经核验了作者所有自由文字。
    const content = { ...advice('B', ['b_cost'], [{ checkId: 'b_budget', inputId: 'b_tuition' }]),
      changeConditions: '任何新增费用都会超预算' };
    fs.writeFileSync(path.join(directory, 'advice.json'), JSON.stringify(content));
    const prepared = decisionPluginCli.prepare({
      argv: ['recommend', record.id, '--expected-revision', '1', '--input', 'advice.json'],
      invocationId: 'basis-admission', conversationRoot: directory,
    });
    if (prepared.status !== 'ready') throw new Error('Expected an admitted plan');
    const reply = await prepared.plan.execute({
      conversationId: 'synthetic-course', projectId: 'p',
      signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } },
    });
    expect(reply.exitCode).toBe(0);
    const projected: unknown = JSON.parse(reply.stdout);
    const saved = command(['read', record.id]);
    expect(projected).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(saved.record.recommendation?.content.changeConditions).toBe(content.changeConditions);
    if (saved.recommendationBasis?.status !== 'current') throw new Error('Expected a program basis');
    expect(saved.recommendationBasis.boundaries[0]?.result).toEqual({ status: 'available', operator: 'lte', value: 2104 });
  });
  it('pairs the departure boundary with all dependent calculations at that point without changing baseline or history', () => {
    const model = courseModel();
    const times = new Map([['departure', 510], ['a_commute', 20], ['a_start', 540], ['b_commute', 45], ['b_start', 570]]);
    model.inputs = model.inputs.map(item => ({ ...item, label: item.label.replace('18:00为0', '当天00:00起'), value: times.get(item.id) ?? item.value }));
    model.inputs.push({ quantityType: 'duration', id: 'padding', label: '额外准备时间', kind: 'fact', value: null, origin: '尚未核清', status: 'available', unit: '分钟' });
    model.calculations.push(
      { quantityType: 'duration', id: 'b_arrival', label: 'B到场时刻', unit: '分钟', expression: add(input('departure'), input('b_commute')) },
      { quantityType: 'duration', id: 'uncertain_arrival', label: '含未核准备的到场', unit: '分钟', expression: add(add(input('departure'), input('b_commute')), input('padding')) },
    );
    const { record } = create(model);
    const view = recommend(record.id, 1, advice('B', ['b_buffer'], [{ checkId: 'b_time', inputId: 'departure' }]));
    if (view.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
    const point = view.recommendationBasis.boundaries[0]?.atBoundary;
    expect(point).toMatchObject({ inputId: 'departure', value: 525 });
    expect(point?.calculations.map(item => item.id)).toEqual(['a_buffer', 'b_buffer', 'b_arrival', 'uncertain_arrival']);
    expect(point?.calculations.find(item => item.id === 'b_arrival')?.result).toEqual({ status: 'available', value: 570 });
    expect(point?.calculations.find(item => item.id === 'b_buffer')?.result).toEqual({ status: 'available', value: 0 });
    expect(point?.calculations.find(item => item.id === 'uncertain_arrival')?.result.status).toBe('unavailable');
    expect(point?.fixedInputIds).toContain('padding'); expect(point?.fixedInputIds).not.toContain('departure');
    expect(view.evaluation.calculations.find(item => item.id === 'b_arrival')?.result).toEqual({ status: 'available', value: 555 });
    expect(view.record.model).toEqual(model); expect(view.record.revision).toBe(2);
    const before = db.prepare('SELECT * FROM decision_record_versions').all();
    db.close(); db = new Database(path.join(directory, 'state.sqlite'));
    expect(command(['read', record.id])).toEqual(view);
    expect(command(['read', record.id, '--revision', '2'])).toEqual(view);
    expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
  });

  it('solves an unknown target only in the boundary point and never revives a withdrawn target', () => {
    const model = courseModel();
    model.inputs = model.inputs.map(item => item.id === 'departure' ? { ...item, value: null } : item);
    const { record } = create(model);
    const view = recommend(record.id, 1, advice('B', ['b_buffer'], [{ checkId: 'b_time', inputId: 'departure' }]));
    if (view.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
    expect(view.recommendationBasis.boundaries[0]?.atBoundary?.calculations.find(item => item.id === 'b_buffer')?.result).toEqual({ status: 'available', value: 0 });
    expect(view.evaluation.calculations.find(item => item.id === 'b_buffer')?.result.status).toBe('unavailable');
    const departure = model.inputs.find(item => item.id === 'departure');
    if (!departure) throw new Error('Fixture missing departure');
    update(record.id, 2, { inputs: [{ ...departure, status: 'withdrawn' }] });
    const changed = recommend(record.id, 3, advice('B', [], [{ checkId: 'b_time', inputId: 'departure' }]));
    if (changed.recommendationBasis?.status !== 'current') throw new Error('Expected current basis');
    expect(changed.recommendationBasis.boundaries[0]?.atBoundary).toBeNull();
    expect(changed.recommendationBasis.boundaries[0]?.result.status).toBe('unavailable');
  });

});
