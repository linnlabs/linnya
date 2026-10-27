import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DecisionRecordSchema } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { remoteOfferModel } from './fixtures/remoteOffer';

let db: Database.Database;
let id: string;
function run(argv: string[], project = 'p') {
  const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('Inline expected');
  return executeDecisionCommand(command, db, project);
}
function check(optionIds: string[], revision = 1, project = 'p') {
  return run(['check', id, '--expected-revision', String(revision), '--json', JSON.stringify({ optionIds })], project);
}
beforeEach(() => {
  db = new Database(':memory:'); db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
  for (const migration of decisionMigrations) migration.up(db);
  const output = run(['create', '--json', JSON.stringify(remoteOfferModel())]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  id = DecisionRecordSchema.parse(output.record).id;
});
afterEach(() => db.close());
it('recomputes declared checks without saving facts/advice, distinguishes unknown, equality and failure, and never grants authorization', () => {
  const rows = () => db.prepare('SELECT * FROM decision_record_versions').all(); const before = rows();
  expect(check(['a', 'b'])).toMatchObject({ overall: 'undetermined', authorization: 'not_evaluated', persisted: false,
    options: [{ optionId: 'a', status: 'undetermined', unknownCheckIds: ['a_remote'] }, { optionId: 'b', status: 'pass' }] });
  expect(rows()).toEqual(before);
  run(['update', id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '收紧底线', inputs: [{ id: 'minimum', label: '最低结余', kind: 'constraint', value: 18000, origin: '用户', status: 'available' }] })]);
  expect(check(['a', 'b'], 2)).toMatchObject({ overall: 'blocked', options: [{ optionId: 'a', status: 'undetermined' }, { optionId: 'b', status: 'fail', failedCheckIds: ['b_budget'] }] });
  run(['update', id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '确认远程', inputs: [{ id: 'a_remote', label: '远程', kind: 'fact', value: true, origin: '用户', status: 'available' }] })]);
  expect(check(['a'], 3)).toMatchObject({ overall: 'declared_checks_pass', authorization: 'not_evaluated' });
  run(['update', id, '--expected-revision', '3', '--json', JSON.stringify({ reason: '撤回确认', inputs: [{ id: 'a_remote', label: '远程', kind: 'fact', value: true, origin: '用户撤回', status: 'withdrawn' }] })]);
  expect(check(['a'], 4)).toMatchObject({ overall: 'undetermined' });
  run(['update', id, '--expected-revision', '4', '--json', JSON.stringify({ reason: '无适用检查', checks: [] })]);
  expect(check(['a'], 5)).toMatchObject({ overall: 'undetermined' });
});
it('rejects missing/duplicate/foreign options, stale revisions and cross-project reads without new versions', () => {
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  expect(() => check([])).toThrow(); expect(() => check(['a', 'a'])).toThrow('Duplicate');
  expect(() => check(['missing'])).toThrow('Unknown option'); expect(() => check(['a'], 2)).toThrow('Revision conflict');
  expect(() => check(['a'], 1, 'other')).toThrow('not found');
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});
it('formal inline bridge declares no conversation file access and keeps database unchanged', async () => {
  const prepared = decisionPluginCli.prepare({ argv: ['check', id, '--expected-revision', '1', '--json', '{"optionIds":["b"]}'], conversationRoot: '/unused', invocationId: 'check' });
  if (prepared.status !== 'ready') throw new Error('Expected admission');
  expect(prepared.plan.access.conversationFiles).toBe('none');
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const result = await prepared.plan.execute({ conversationId: 'c', agentRunId: 'r', projectId: 'p', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ overall: 'declared_checks_pass', authorization: 'not_evaluated' });
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});
