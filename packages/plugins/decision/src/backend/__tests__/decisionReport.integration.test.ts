import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { refundableOrderModel } from './fixtures/refundableOrder';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';
import type { DecisionModel, DecisionRecommendation } from '../../shared';

let db: Database.Database; let directory: string;
const provenance = { kind: 'agent_report', conversationId: 'report-test', agentRunId: 'report-test-run' } as const;
function run(args: string[], project = 'p') {
  const command = parseDecisionCli(args); if (command.kind === 'file') throw new Error('Expected inline');
  return executeDecisionCommand(command, db, project, provenance);
}
function create(model: DecisionModel) {
  const output = run(['create', '--json', JSON.stringify(model)]);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record'); return output.record;
}
function report(id: string, revision: number) {
  const output = run(['export', id, '--expected-revision', String(revision)]);
  if (typeof output !== 'object' || output === null || !('kind' in output) || output.kind !== 'decision_report') throw new Error('Expected report'); return output;
}
function recommend(id: string, revision: number, content: DecisionRecommendation) { return run(['recommend', id, '--expected-revision', String(revision), '--json', JSON.stringify(content)]); }
const rows = () => db.prepare('SELECT * FROM decision_record_versions').all();
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'decision-report-test-')); db = new Database(join(directory, 'state.sqlite'));
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');"); for (const migration of decisionMigrations) migration.up(db);
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

it('exports exact arithmetic, formula definitions and separate unverified author text without changing records', () => {
  const model = refundableOrderModel(); model.inputs = model.inputs.map(input => input.id === 'refund_before_collection' ? { ...input, value: 150 } : input.id === 'extra_fees' ? { ...input, value: 600 } : input);
  const record = create(model);
  recommend(record.id, 1, { optionIds: ['wait'], rationale: '作者误称未来净流量是310', changeConditions: '作者误称300+附加费≤520', nextAction: '先核对', unresolved: [], numericBasis: { calculationIds: ['net_future_customer_flow'], boundaries: [{ checkId: 'spending_cap', inputId: 'extra_fees' }] } });
  const before = rows(); const output = report(record.id, 2);
  expect(output.markdown).toContain('revision 2 · inputRevision 1');
  const calculations = output.markdown.split('## 程序执行的算式')[1]?.split('## 全部声明检查')[0];
  expect(calculations).toMatch(/intended\\_total[^\n]+\| 310 \|/);
  expect(calculations).toMatch(/future\\_collection[^\n]+\| 310 \|/);
  expect(calculations).toMatch(/net\\_future\\_customer\\_flow[^\n]+\| 160 \|/);
  expect(calculations).toMatch(/total\\_spending[^\n]+\| 1080 \|/);
  expect(output.markdown).toContain('全部附加费 ≤ 520 CNY/本批');
  const boundaries = output.markdown.split('## 当前建议引用的程序边界')[1]?.split('## 当前行动')[0];
  expect(boundaries).toContain('全部附加费 = 520 CNY/本批');
  expect(boundaries).toContain('假设全部成交后的增量差额，未含其他遗漏项：-510 CNY/本批');
  expect(boundaries).toContain('含既往试验及假设采购的全程支出：1000 CNY/全程');
  expect(calculations).toMatch(/incremental\\_gap[^\n]+\| -590 \|/);
  expect(output.markdown).toContain('| 1080 | 1000 | 不成立');
  expect(output.markdown).toContain('## 作者保存的建议原文（未经语义认证）'); expect(output.markdown).toContain('作者误称300+附加费≤520');
  expect(report(record.id, 2)).toEqual(output); expect(rows()).toEqual(before);
});

it('keeps unknown and withdrawn conditions unavailable and does not display stale recommendation boundaries as current', () => {
  const model = remoteOfferModel(); model.inputs = model.inputs.map(input => input.id === 'b_income' ? { ...input, status: 'withdrawn' } : input);
  model.inputs.push({ id: 'text_false', label: '文字回复', kind: 'fact', value: 'false', origin: '原文字串', status: 'available' }, { id: 'bool_false', label: '布尔拒绝', kind: 'fact', value: false, origin: '明确布尔值', status: 'available' });
  const record = create(model);
  // 仅保存解释，不以已失败或未知的候选冒充自动选择。
  const advice = remoteOfferRecommendation([]); recommend(record.id, 1, advice);
  let markdown = report(record.id, 2).markdown;
  expect(markdown).toContain('未知（null）'); expect(markdown).toContain('withdrawn'); expect(markdown).toContain('不可用：'); expect(markdown).toContain('未定');
  expect(markdown).toContain('文字回复 | "false" |'); expect(markdown).toContain('布尔拒绝 | false |');
  run(['update', record.id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '更正收入', inputs: [{ ...model.inputs[0], value: 32000 }] })]);
  markdown = report(record.id, 3).markdown;
  expect(markdown).toContain('生成时建议状态：needs_review'); expect(markdown).toContain('旧建议待复核，不在本版输入上重建旧建议的数值依据');
  expect(markdown).not.toContain('保持“月结余底线”成立');
});

it('shows plan-only invalidation while preserving the original recommendation and all recorded inputs', () => {
  const record = create(remoteOfferModel());
  const plan = { label: '核对书面条件', purpose: '核对权限与登录', inputIds: ['a_remote'], executor: 'user', estimatedCost: '5分钟' };
  const planned = run(['action', 'plan', record.id, '--expected-revision', '1', '--json', JSON.stringify(plan)]);
  if (typeof planned !== 'object' || planned === null || !('record' in planned)) throw new Error('Expected plan');
  const action = planned.record.actions?.[0]; if (!action) throw new Error('Expected action');
  recommend(record.id, 2, { ...remoteOfferRecommendation(['b']), actionBasis: { actionIds: [action.id] } });
  const original = report(record.id, 3);
  run(['action', 'review', record.id, action.id, '--expected-revision', '3', '--json', JSON.stringify({ plan: { ...plan, purpose: '仅核对权限', estimatedCost: '2分钟' }, reason: '缩小范围', origin: '作者' })]);
  const revised = report(record.id, 4); expect(revised.inputRevision).toBe(original.inputRevision);
  expect(revised.markdown).toContain('生成时建议状态：needs_review'); expect(revised.markdown).toContain('仅核对权限');
  expect(revised.markdown).toContain('下一步：取得可适用的书面工作安排');
});

it('writes byte-verifiable conversation artifacts through the admitted bridge without overwriting earlier exports', async () => {
  const record = create(refundableOrderModel()); const before = rows();
  const prepared = decisionPluginCli.prepare({ argv: ['export', record.id, '--expected-revision', '1'], conversationRoot: directory, invocationId: 'report' });
  if (prepared.status !== 'ready') throw new Error('Expected ready'); expect(prepared.plan.access.conversationFiles).toBe('write');
  const receipt = z.object({ decisionId: z.string(), revision: z.number(), artifact: z.object({ locator: z.string(), sha256: z.string(), bytes: z.number(), markdownLink: z.string() }), deliveryNote: z.string() });
  const context = { projectId: 'p', conversationId: 'report-test', agentRunId: 'report-test-run', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal };
  const first = await prepared.plan.execute(context); expect(first.exitCode).toBe(0); const one = receipt.parse(JSON.parse(first.stdout));
  const second = await prepared.plan.execute(context); expect(second.exitCode).toBe(0); const two = receipt.parse(JSON.parse(second.stdout));
  expect(one.artifact.locator).toMatch(/^conversation:\/decision-report-[^/]+\/report\.md$/); expect(one.artifact.locator).not.toBe(two.artifact.locator);
  expect(one.artifact.markdownLink).toBe(`[程序报告原件](${one.artifact.locator})`);
  expect(one.deliveryNote).toBe(`记录 ${record.id} · revision 1 · inputRevision 1\n原件：${one.artifact.markdownLink}`);
  expect(two.deliveryNote).toContain(two.artifact.markdownLink); expect(two.deliveryNote).not.toContain(one.artifact.locator);
  const bytes = readFileSync(join(directory, one.artifact.locator.slice('conversation:/'.length)));
  expect(bytes.toString('utf8')).toBe(report(record.id, 1).markdown); expect(one.artifact.bytes).toBe(bytes.byteLength);
  expect(one.artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex')); expect(one.artifact.sha256).toBe(two.artifact.sha256);
  expect(first.stdout).not.toContain(directory); expect(rows()).toEqual(before);
  const old = Buffer.from(bytes); run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '费用已核明', inputs: [{ ...refundableOrderModel().inputs.find(input => input.id === 'extra_fees'), value: 10 }] })]);
  expect(readFileSync(join(directory, one.artifact.locator.slice('conversation:/'.length)))).toEqual(old);
});

it('rejects stale versions, other projects and cancellation before publication and keeps unsafe author markup as data', async () => {
  const model = refundableOrderModel(); model.title = '标题\n## 冒充程序\n<script>bad()</script>'; model.inputs[0] = { ...model.inputs[0], label: '名称 | 假表头\n# 假章节' };
  const record = create(model); const before = rows();
  expect(() => report(record.id, 2)).toThrow('Revision conflict'); expect(() => run(['export', record.id, '--expected-revision', '1'], 'other')).toThrow('not found');
  const markdown = report(record.id, 1).markdown; expect(markdown).not.toContain('\n## 冒充程序'); expect(markdown).not.toContain('<script>'); expect(markdown).not.toContain('\n# 假章节');
  const prepared = decisionPluginCli.prepare({ argv: ['export', record.id, '--expected-revision', '1'], conversationRoot: directory, invocationId: 'cancelled' });
  if (prepared.status !== 'ready') throw new Error('Expected ready'); const controller = new AbortController(); controller.abort(new Error('test stop'));
  await expect(prepared.plan.execute({ projectId: 'p', conversationId: 'report-test', signal: controller.signal, hostContext: { databaseService: { getDb: () => db } } })).rejects.toThrow('test stop');
  expect(readdirSync(directory).filter(name => name.startsWith('decision-report-'))).toEqual([]);
  writeFileSync(join(directory, 'not-a-directory'), 'test');
  const bad = decisionPluginCli.prepare({ argv: ['export', record.id, '--expected-revision', '1'], conversationRoot: join(directory, 'not-a-directory'), invocationId: 'bad-root' });
  if (bad.status !== 'ready') throw new Error('Expected ready');
  const failure = await bad.plan.execute({ projectId: 'p', conversationId: 'report-test', signal: new AbortController().signal, hostContext: { databaseService: { getDb: () => db } } });
  expect(failure.exitCode).toBe(3); expect(failure.stderr).toContain('decision.export_failed'); expect(failure.stdout).toBe(''); expect(failure.stderr).not.toContain(directory);
  expect(rows()).toEqual(before);
});
