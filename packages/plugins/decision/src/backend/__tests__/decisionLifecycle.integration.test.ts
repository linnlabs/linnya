import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DecisionRecordSchema, type DecisionExpression, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';


const input = (id: string): DecisionExpression => ({ input: id });
const literal = (value: number): DecisionExpression => ({ literal: value });
const cost = (daily: string): DecisionExpression => ({
  op: 'add', left: literal(500),
  right: { op: 'multiply', left: input('days'), right: input(daily) },
});

function travelModel(): DecisionModel {
  return {
    title: '合成旅行测试', question: '在预算内选择合适方案',
    inputs: [
      { quantityType: 'money', id: 'budget', label: '预算', kind: 'constraint', value: 4000, unit: 'CNY/次', origin: '测试给定', status: 'available' },
      { quantityType: 'duration', id: 'days', label: '住宿天数', kind: 'fact', value: 4, unit: '天', origin: '测试给定', status: 'available' },
      { quantityType: 'money', id: 'comfort', label: '舒适方案每日费用', kind: 'fact', value: 700, unit: 'CNY/天', origin: '测试报价', status: 'available' },
      { quantityType: 'money', id: 'simple', label: '经济方案每日费用', kind: 'fact', value: 450, unit: 'CNY/天', origin: '测试报价', status: 'available' },
      { quantityType: 'other', id: 'priority', label: '偏好', kind: 'preference', value: '预算允许时优先舒适', origin: '用户明确给定', status: 'available' },
    ],
    options: [
      { id: 'A', label: '舒适', description: '中心位置住宿' },
      { id: 'B', label: '经济', description: '较远位置住宿' },
    ],
    calculations: [
      { quantityType: 'money', id: 'aCost', label: '舒适总费用', unit: 'CNY/次', expression: cost('comfort') },
      { quantityType: 'money', id: 'bCost', label: '经济总费用', unit: 'CNY/次', expression: cost('simple') },
    ],
    checks: ['comfort', 'simple'].map((daily, index) => ({
      id: index === 0 ? 'aBudget' : 'bBudget', optionId: index === 0 ? 'A' : 'B',
      label: '总费用不超预算', left: cost(daily), operator: 'lte', right: input('budget'),
    })),
  };
}

const recommendation = (option: string) => ({
  optionIds: [option], rationale: '结合预算与住宿偏好比较',
  changeConditions: '预算或报价发生变化时重新比较', nextAction: '在确认行程后核对实际报价', unresolved: [],
});
const viewSchema = z.object({
  record: DecisionRecordSchema,
  recommendationStatus: z.enum(['current', 'needs_review', 'missing']),
  evaluation: z.object({
    calculations: z.array(z.object({ id: z.string(), result: z.object({ status: z.string(), value: z.number().optional() }) })),
    checks: z.array(z.object({ id: z.string(), passes: z.boolean().nullable() })),
  }),
});

describe('decision prototype lifecycle through CLI and SQLite', () => {
  let db: Database.Database;
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-decision-'));
    db = new Database(path.join(root, 'state.sqlite'));
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES (\'p1\'), (\'p2\');');
    for (const migration of decisionMigrations) migration.up(db);
  });
  afterEach(() => {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function run(args: readonly string[], project = 'p1') {
    const command = parseDecisionCli(args);
    if (command.kind === 'file') throw new Error('File input must run through the authorized App bridge plan.');
    return executeDecisionCommand(command, db, project);
  }
  function create() {
    return viewSchema.parse(run(['create', '--json', JSON.stringify(travelModel())]));
  }

  it('recomputes after budget change, rejects infeasible advice and preserves the previous recommendation as stale', () => {
    const first = create();
    expect(first.evaluation.calculations.map(item => item.result.value)).toEqual([3300, 2300]);
    const { id } = first.record;
    const advised = viewSchema.parse(run(['recommend', id, '--expected-revision', '1', '--json', JSON.stringify(recommendation('A'))]));
    expect(advised.recommendationStatus).toBe('current');
    const update = { reason: '预算降低', inputs: [{ ...travelModel().inputs[0], value: 2500 }] };
    const changed = viewSchema.parse(run(['update', id, '--expected-revision', '2', '--json', JSON.stringify(update)]));
    expect(changed.recommendationStatus).toBe('needs_review');
    expect(changed.evaluation.checks.map(check => check.passes)).toEqual([false, true]);
    expect(changed.record.recommendation?.content.optionIds).toEqual(['A']);
    expect(() => run(['recommend', id, '--expected-revision', '3', '--json', JSON.stringify(recommendation('A'))])).toThrow('violates');
    const final = viewSchema.parse(run(['recommend', id, '--expected-revision', '3', '--json', JSON.stringify(recommendation('B'))]));
    expect(final.recommendationStatus).toBe('current');
    expect(final.record.revision).toBe(4);
    expect(viewSchema.parse(run(['read', id, '--revision', '2'])).record.model.inputs[0]?.value).toBe(4000);
  });

  it('recomputes formula outputs when a factual input changes', () => {
    const first = create();
    const update = { reason: '天数调整', inputs: [{ ...travelModel().inputs[1], value: 5 }] };
    const changed = viewSchema.parse(run(['update', first.record.id, '--expected-revision', '1', '--json', JSON.stringify(update)]));
    expect(changed.evaluation.calculations.map(item => item.result.value)).toEqual([4000, 2750]);
  });

  it('preference changes invalidate advice even when arithmetic is unchanged', () => {
    const first = create();
    run(['recommend', first.record.id, '--expected-revision', '1', '--json', JSON.stringify(recommendation('A'))]);
    const update = { reason: '用户改为优先省钱', inputs: [{ ...travelModel().inputs[4], value: '优先省钱' }] };
    const changed = viewSchema.parse(run(['update', first.record.id, '--expected-revision', '2', '--json', JSON.stringify(update)]));
    expect(changed.recommendationStatus).toBe('needs_review');
    expect(changed.evaluation.calculations).toEqual(first.evaluation.calculations);
  });

  it('withdrawn source inputs make dependent calculations and checks unavailable without replacing them with zero', () => {
    const first = create();
    const update = { reason: '报价来源撤回', inputs: [{ ...travelModel().inputs[2], status: 'withdrawn' }] };
    const changed = viewSchema.parse(run(['update', first.record.id, '--expected-revision', '1', '--json', JSON.stringify(update)]));
    expect(changed.evaluation.calculations[0]?.result).toEqual({ status: 'unavailable' });
    expect(changed.evaluation.checks[0]?.passes).toBeNull();
    expect(changed.evaluation.calculations[1]?.result.value).toBe(2300);
  });

  it('rejects stale writes and malformed references without appending a version', () => {
    const first = create();
    const args = ['update', first.record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '改天数', inputs: [{ ...travelModel().inputs[1], value: 5 }] })];
    run(args);
    expect(() => run(args)).toThrow('No decision conditions changed');
    const stale = ['recommend', first.record.id, '--expected-revision', '1', '--json', JSON.stringify(recommendation('A'))];
    expect(() => run(stale)).toThrow('Revision conflict');
    const invalid = { ...travelModel(), calculations: [{ quantityType: 'money', id: 'bad', label: 'bad', unit: 'CNY', expression: input('absent') }] };
    expect(() => run(['create', '--json', JSON.stringify(invalid)])).toThrow('Unknown input');
    expect(viewSchema.parse(run(['read', first.record.id])).record.revision).toBe(2);
  });

  it('survives database reopen, scopes reads to the Host project, and deletes records with their project', () => {
    const first = create();
    db.close();
    db = new Database(path.join(root, 'state.sqlite'));
    db.pragma('foreign_keys = ON');
    expect(viewSchema.parse(run(['read', first.record.id])).record).toEqual(first.record);
    expect(run(['list'], 'p2')).toEqual([]);
    expect(() => run(['read', first.record.id], 'p2')).toThrow('not found');
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
    expect(run(['list'])).toEqual([]);
  });

  it('prepares commands without DB access, returns actionable business errors and honours cancellation', async () => {
    const first = create();
    const prepared = decisionPluginCli.prepare({ argv: ['read', first.record.id], invocationId: 'test', conversationRoot: root });
    if (prepared.status !== 'ready') throw new Error('Expected a ready plan');
    expect(prepared.plan.access.conversationFiles).toBe('none');
    const controller = new AbortController();
    const context = { databaseService: { getDb: () => db } };
    const result = await prepared.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: controller.signal, hostContext: context });
    expect(result.exitCode).toBe(0);
    const missing = decisionPluginCli.prepare({ argv: ['read', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], invocationId: 'test', conversationRoot: root });
    if (missing.status !== 'ready') throw new Error('Expected a ready plan');
    const failure = await missing.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: controller.signal, hostContext: context });
    expect(failure.exitCode).toBe(3);
    expect(failure.stderr).toContain('decision.not_found');
    controller.abort();
    await expect(prepared.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: controller.signal, hostContext: context })).rejects.toThrow();
  });

  it('keeps qualitative decisions possible and returns unknown for zero divisors', () => {
    const model = travelModel();
    const qualitative = { ...model, calculations: [], checks: [] };
    expect(viewSchema.parse(run(['create', '--json', JSON.stringify(qualitative)])).evaluation.calculations).toEqual([]);
    const divideByZero = { ...model, calculations: [{ quantityType: 'other', id: 'ratio', label: 'ratio', unit: 'ratio', expression: { op: 'divide', left: input('budget'), right: literal(0) } }] };
    expect(viewSchema.parse(run(['create', '--json', JSON.stringify(divideByZero)])).evaluation.calculations[0]?.result.status).toBe('unavailable');
  });

  it('loads a model larger than the argv limit from a conversation file after admission', async () => {
    const model = { ...travelModel(), question: '这是明确的测试背景。'.repeat(600) };
    fs.writeFileSync(path.join(root, 'model.json'), JSON.stringify(model));
    expect(JSON.stringify(model).length).toBeGreaterThan(4096);
    const prepared = decisionPluginCli.prepare({ argv: ['create', '--input', 'model.json'], invocationId: 'file-test', conversationRoot: root });
    if (prepared.status !== 'ready') throw new Error('Expected a ready file-input plan');
    const result = await prepared.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
    expect(result.exitCode).toBe(0);
    const value: unknown = JSON.parse(result.stdout);
    const created = viewSchema.parse(value);
    expect(created.evaluation.calculations.map(item => item.result.value)).toEqual([3300, 2300]);
    fs.writeFileSync(path.join(root, 'update.json'), JSON.stringify({ reason: '预算降低', inputs: [{ ...model.inputs[0], value: 2500 }] }));
    const update = decisionPluginCli.prepare({ argv: ['update', created.record.id, '--expected-revision', '1', '--input', 'update.json'], invocationId: 'file-update', conversationRoot: root });
    if (update.status !== 'ready') throw new Error('Expected a ready update plan');
    expect((await update.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } })).exitCode).toBe(0);
    fs.writeFileSync(path.join(root, 'advice.json'), JSON.stringify(recommendation('B')));
    const advice = decisionPluginCli.prepare({ argv: ['recommend', created.record.id, '--expected-revision', '2', '--input', 'advice.json'], invocationId: 'file-advice', conversationRoot: root });
    if (advice.status !== 'ready') throw new Error('Expected a ready recommendation plan');
    const advised = await advice.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
    const final: unknown = JSON.parse(advised.stdout);
    expect(viewSchema.parse(final).record.recommendation?.content.optionIds).toEqual(['B']);
    expect(viewSchema.parse(final).recommendationStatus).toBe('current');
  });

  it('rejects traversal and malformed file input without saving a record', async () => {
    fs.writeFileSync(path.join(root, 'broken.json'), '{');
    for (const file of ['../outside.json', 'broken.json', 'missing.json']) {
      const prepared = decisionPluginCli.prepare({ argv: ['create', '--input', file], invocationId: 'file-test', conversationRoot: root });
      if (prepared.status !== 'ready') throw new Error('Expected a ready plan');
      const result = await prepared.plan.execute({ conversationId: 'conv-p1', projectId: 'p1', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
      expect(result.exitCode).not.toBe(0);
    }
    expect(run(['list'])).toEqual([]);
  });
});
