import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionActionPlan, type DecisionActionResolution } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';
import { createDecisionRecordRepository } from '../features/decision-record';

const plan: DecisionActionPlan = { label: '询问适用确认', purpose: '补足影响选择的未知', inputIds: ['a_remote'], executor: 'user', estimatedCost: '预计5分钟，0CNY' };
const result: DecisionActionResolution = { outcome: 'completed', summary: '用户已取得适用确认', origin: '合成用户本轮报告，未独立核验', actualCost: '实际3分钟，0CNY', update: { reason: '问询带回确认', inputs: [{ quantityType: 'other', id: 'a_remote', label: 'A有适用的全远程书面确认', kind: 'fact', value: true, origin: '合成用户报告', status: 'available' }] } };

describe('action plans and feedback through CLI and SQLite', () => {
  let db: Database.Database;
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-feedback-'));
    db = new Database(path.join(directory, 'state.sqlite'));
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
    for (const migration of decisionMigrations) migration.up(db);
  });
  afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function run(argv: readonly string[], project = 'p') {
    const command = parseDecisionCli(argv);
    if (command.kind === 'file') throw new Error('Use the admitted bridge for files');
    return executeDecisionCommand(command, db, project, { kind: 'agent_report', conversationId: 'synthetic', agentRunId: 'synthetic-run' });
  }
  function read(id: string, revision?: number) {
    const output = run(['read', id, ...(revision ? ['--revision', String(revision)] : [])]);
    if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
    return { ...output, record: DecisionRecordSchema.parse(output.record) };
  }
  function create() {
    const output = run(['create', '--json', JSON.stringify(remoteOfferModel())]);
    if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
    return DecisionRecordSchema.parse(output.record);
  }
  function planned(id: string, revision: number, value = plan) {
    run(['action', 'plan', id, '--expected-revision', String(revision), '--json', JSON.stringify(value)]);
    const action = read(id).record.actions?.at(-1);
    if (!action) throw new Error('Expected saved action');
    return action;
  }
  function resolve(id: string, actionId: string, revision: number, value = result) {
    return run(['action', 'resolve', id, actionId, '--expected-revision', String(revision), '--json', JSON.stringify(value)]);
  }
  function withdraw(id: string, actionId: string, revision: number, payload: unknown = { reason: '报告对应错了行动', origin: '用户明确更正' }, project = 'p') {
    return run(['action', 'withdraw', id, actionId, '--expected-revision', String(revision), '--json', JSON.stringify(payload)], project);
  }

  it('keeps actual Agent identity separate from origin text, rejects forged provenance, and labels old reports unbound', () => {
    const record = create(); const action = planned(record.id, 1);
    const before = read(record.id);
    expect(() => resolve(record.id, action.id, 2, { ...result, provenance: { kind: 'conversation_input_quote' } })).toThrow();
    expect(read(record.id)).toEqual(before);
    const command = parseDecisionCli(['action', 'resolve', record.id, action.id, '--expected-revision', '2', '--json', JSON.stringify(result)]);
    if (command.kind === 'file') throw new Error('Inline expected');
    expect(() => executeDecisionCommand(command, db, 'p')).toThrow('Host-supplied provenance');
    resolve(record.id, action.id, 2);
    expect(read(record.id).record.actions?.[0]?.result?.provenance).toEqual({ kind: 'agent_report', conversationId: 'synthetic', agentRunId: 'synthetic-run' });
    const current = read(record.id).record;
    const legacy = { ...current, revision: 4, actions: current.actions?.map(item => {
      if (!item.result) throw new Error('Result expected');
      const oldResult = { ...item.result };
      delete oldResult.provenance;
      return { ...item, result: oldResult };
    }) };
    createDecisionRecordRepository(db, 'p').append(legacy, 3);
    expect(read(record.id).actionStates).toMatchObject([{ reportSource: 'unbound', withdrawalSource: null }]);
    expect(read(record.id, 3).actionStates).toMatchObject([{ reportSource: 'agent_report' }]);
  });

  it('keeps a plan separate from execution, atomically receives its facts, and requires a fresh recommendation', () => {
    const record = create();
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(remoteOfferRecommendation())]);
    const before = read(record.id);
    const action = planned(record.id, 2);
    const afterPlan = read(record.id);
    expect(afterPlan.record.model).toEqual(before.record.model);
    expect(afterPlan.record.inputRevision).toBe(1);
    expect(afterPlan.recommendationStatus).toBe('current');
    expect(action.result).toBeUndefined();
    resolve(record.id, action.id, 3);
    const after = read(record.id);
    expect(after.record.revision).toBe(4);
    expect(after.record.inputRevision).toBe(2);
    expect(after.record.actions?.[0]?.result).toMatchObject({ actualCost: '实际3分钟，0CNY', receivedAtRevision: 4, receivedAgainstInputRevision: 1, resultingInputRevision: 2 });
    expect(after.record.actions?.[0]?.plan.estimatedCost).toBe('预计5分钟，0CNY');
    expect(after.recommendationStatus).toBe('needs_review');
    expect(after.conditionalAdvice).toEqual({ status: 'needs_review', basedOnInputRevision: 1 });
    expect(after.evaluation.checks.find(check => check.id === 'a_remote')?.passes).toBe(true);
    run(['recommend', record.id, '--expected-revision', '4', '--json', JSON.stringify(remoteOfferRecommendation(['a']))]);
    expect(read(record.id).conditionalAdvice).toMatchObject({ baseline: { outcome: { status: 'ranked_choice', optionIds: ['a'] } } });
    expect(read(record.id, 3).record.actions?.[0]?.result).toBeUndefined();
  });

  it('rejects invalid model feedback, duplicates, stale versions and cross-project reception without partial writes', () => {
    const record = create();
    const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
    const initial = rows();
    expect(() => planned(record.id, 1, { ...plan, inputIds: ['missing'] })).toThrow('Unknown action input');
    expect(rows()).toEqual(initial);
    const action = planned(record.id, 1);
    const before = rows();
    expect(() => resolve(record.id, action.id, 2, { ...result, update: { reason: '坏引用', checks: [{ id: 'bad', optionId: 'missing', label: '坏检查', operator: 'is', inputId: 'a_remote', value: true }] } })).toThrow();
    expect(rows()).toEqual(before);
    expect(() => resolve(record.id, action.id, 1)).toThrow('Revision conflict');
    expect(rows()).toEqual(before);
    expect(() => run(['action', 'resolve', record.id, action.id, '--expected-revision', '2', '--json', JSON.stringify(result)], 'other')).toThrow('not found');
    expect(rows()).toEqual(before);
    resolve(record.id, action.id, 2);
    const received = rows();
    expect(() => resolve(record.id, action.id, 3)).toThrow('already has a result');
    expect(rows()).toEqual(received);
  });

  it('receives a cancellation or observation without a model patch, preserves costs and marks advice for review', () => {
    const record = create();
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(remoteOfferRecommendation(['b']))]);
    const action = planned(record.id, 2);
    resolve(record.id, action.id, 3, { outcome: 'cancelled', summary: '对方取消问询，没有新确认', origin: '用户报告', actualCost: '已用2分钟，0CNY' });
    const saved = read(record.id);
    expect(saved.record.model).toEqual(record.model);
    expect(saved.record.inputRevision).toBe(2);
    expect(saved.recommendationStatus).toBe('needs_review');
    expect(saved.record.actions?.[0]?.result?.outcome).toBe('cancelled');
    expect(saved.evaluation.checks.find(check => check.id === 'a_remote')?.passes).toBeNull();
  });

  it('receives late feedback against current inputs, preserves history after reopen, and compares without writing', () => {
    const record = create();
    const action = planned(record.id, 1);
    run(['update', record.id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '决策范围明确', title: '更新后的取舍', question: '按最新条件继续' })]);
    resolve(record.id, action.id, 3);
    db.close();
    db = new Database(path.join(directory, 'state.sqlite'));
    const current = read(record.id);
    expect(current.record.actions?.[0]?.basedOnInputRevision).toBe(1);
    expect(current.record.actions?.[0]?.result).toMatchObject({ receivedAgainstInputRevision: 2, resultingInputRevision: 3 });
    expect(current.record.model.title).toBe('更新后的取舍');
    expect(read(record.id, 2).record.model.title).toBe(record.model.title);
    const before = db.prepare('SELECT * FROM decision_record_versions').all();
    const compared = run(['compare', record.id, '--from', '2', '--to', '4']);
    if (typeof compared !== 'object' || compared === null || !('actionChanges' in compared)) throw new Error('Expected comparison');
    expect(compared.actionChanges.changed[0]?.id).toBe(action.id);
    expect(compared.changes.title).toEqual({ before: record.model.title, after: '更新后的取舍' });
    expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
  });

  it('adds a discovered option with the actual observation in one version without accepting an old preference', () => {
    const record = create();
    run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(remoteOfferRecommendation())]);
    const action = planned(record.id, 2, { ...plan, label: '寻找替代安排', inputIds: [] });
    resolve(record.id, action.id, 3, { ...result, update: { reason: '发现新安排', options: [...record.model.options, { obligationIds: [], id: 'c', label: 'C', description: '新取得安排，仍需比较' }] } });
    const saved = read(record.id);
    expect(saved.record.model.options.map(option => option.id)).toEqual(['a', 'b', 'c']);
    expect(saved.record.actions?.[0]?.result?.summary).toBe(result.summary);
    expect(saved.recommendationStatus).toBe('needs_review');
    expect(() => run(['recommend', record.id, '--expected-revision', '4', '--json', JSON.stringify(remoteOfferRecommendation(['b']))])).toThrow();
    expect(read(record.id).record.revision).toBe(4);
  });

  it('admits file plans and feedback through the formal project bridge and does not change the source files', async () => {
    const record = create();
    async function fileCommand(argv: string[], filename: string, payload: unknown) {
      const content = JSON.stringify(payload);
      fs.writeFileSync(path.join(directory, filename), content);
      const prepared = decisionPluginCli.prepare({ argv: [...argv, '--input', filename], conversationRoot: directory, invocationId: filename });
      if (prepared.status !== 'ready') throw new Error('Expected admission');
      const reply = await prepared.plan.execute({ conversationId: 'synthetic', agentRunId: 'synthetic-run', projectId: 'p', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
      expect(reply.exitCode).toBe(0);
      expect(fs.readFileSync(path.join(directory, filename), 'utf8')).toBe(content);
      return reply;
    }
    await fileCommand(['action', 'plan', record.id, '--expected-revision', '1'], 'plan.json', plan);
    const action = read(record.id).record.actions?.[0];
    if (!action) throw new Error('Expected action');
    await fileCommand(['action', 'resolve', record.id, action.id, '--expected-revision', '2'], 'result.json', result);
    expect(read(record.id).record.actions?.[0]?.result?.outcome).toBe('completed');
    await fileCommand(['action', 'withdraw', record.id, action.id, '--expected-revision', '3'], 'withdraw.json', { reason: '用户更正报告', origin: '用户本轮' });
    expect(read(record.id).actionStates).toMatchObject([{ id: action.id, state: 'report_withdrawn' }]);
  });

  it('withdraws a report explicitly without undoing real model facts or erasing the old completion', () => {
    const record = create();
    const action = planned(record.id, 1);
    resolve(record.id, action.id, 2);
    run(['recommend', record.id, '--expected-revision', '3', '--json', JSON.stringify(remoteOfferRecommendation(['a']))]);
    const before = read(record.id);
    withdraw(record.id, action.id, 4);
    const after = read(record.id);
    expect(after.record.model).toEqual(before.record.model);
    expect(after.record.revision).toBe(5);
    expect(after.record.inputRevision).toBe(3);
    expect(after.recommendationStatus).toBe('needs_review');
    expect(after.actionStates).toMatchObject([{ id: action.id, state: 'report_withdrawn' }]);
    expect(after.record.actions?.[0]?.result).toMatchObject({ summary: result.summary, actualCost: result.actualCost, withdrawal: { reason: '报告对应错了行动', receivedAtRevision: 5 } });
    expect(read(record.id, 3).actionStates).toMatchObject([{ id: action.id, state: 'reported_completed' }]);
    expect(read(record.id, 3).record.actions?.[0]?.result?.withdrawal).toBeUndefined();
    const delta = run(['compare', record.id, '--from', '4', '--to', '5']);
    if (typeof delta !== 'object' || delta === null || !('actionChanges' in delta)) throw new Error('Expected comparison');
    expect(delta.actionChanges.changed[0]?.after.result?.withdrawal?.origin).toBe('用户明确更正');
  });

  it('rejects withdrawal without a report, repeat reception, invalid corrections, stale versions and other projects atomically', () => {
    const record = create();
    const action = planned(record.id, 1);
    const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
    const plannedRows = rows();
    expect(() => withdraw(record.id, action.id, 2)).toThrow('No reported result');
    expect(rows()).toEqual(plannedRows);
    resolve(record.id, action.id, 2);
    const before = rows();
    expect(() => withdraw(record.id, action.id, 3, { reason: '坏模型', origin: '用户', update: { reason: '不合法引用', checks: [{ id: 'bad', optionId: 'none', label: '缺项', operator: 'is', inputId: 'a_remote', value: true }] } })).toThrow();
    expect(rows()).toEqual(before);
    expect(() => withdraw(record.id, action.id, 2)).toThrow('Revision conflict');
    expect(() => withdraw(record.id, action.id, 3, undefined, 'other')).toThrow('not found');
    expect(rows()).toEqual(before);
    withdraw(record.id, action.id, 3);
    const after = rows();
    expect(() => withdraw(record.id, action.id, 4)).toThrow('already withdrawn');
    expect(() => resolve(record.id, action.id, 4)).toThrow('already has a result');
    expect(rows()).toEqual(after);
  });

  it('withdraws a source report and explicitly corrects only the affected facts in the same saved version', () => {
    const record = create();
    const action = planned(record.id, 1);
    resolve(record.id, action.id, 2);
    const remote = read(record.id).record.model.inputs.find(input => input.id === 'a_remote');
    if (!remote) throw new Error('Expected input');
    withdraw(record.id, action.id, 3, { reason: '确认不适用', origin: '用户更正', update: { reason: '撤回这份确认依据', inputs: [{ ...remote, status: 'withdrawn' }] } });
    const after = read(record.id);
    expect(after.record.revision).toBe(4);
    expect(after.record.model.inputs.find(input => input.id === 'a_remote')).toMatchObject({ value: true, status: 'withdrawn' });
    expect(after.evaluation.checks.find(check => check.id === 'a_remote')?.passes).toBeNull();
    expect(after.record.actions?.[0]?.result?.withdrawal).toMatchObject({ receivedAtRevision: 4, resultingInputRevision: 3 });
    expect(read(record.id, 3).evaluation.checks.find(check => check.id === 'a_remote')?.passes).toBe(true);
  });
});
