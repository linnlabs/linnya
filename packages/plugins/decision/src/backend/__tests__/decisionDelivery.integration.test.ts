import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { createDecisionRecordRepository, renderDecisionDelivery } from '../features/decision-record';
import { deliveryPurchaseModel, deliveryPurchaseAdvice } from './fixtures/deliveryPurchase';
import type { DecisionModel, DecisionRecommendation } from '../../shared';
import { z } from 'zod';

let db: Database.Database; let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'decision-delivery-')); db = new Database(':memory:'); db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');"); for (const m of decisionMigrations) m.up(db); });
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
function seed(model = deliveryPurchaseModel(), advice = deliveryPurchaseAdvice()) {
  const created = executeDecisionCommand({ kind: 'create', model }, db, 'p');
  if (!created || typeof created !== 'object' || !('record' in created)) throw new Error('fixture');
  const id = created.record.id;
  executeDecisionCommand({ kind: 'recommend', id, expectedRevision: 1, recommendation: advice }, db, 'p'); return id;
}
function read(id: string) { return createDecisionRecordRepository(db, 'p').read(id); }
it('delivers the unpaid and actually-funded cases without replacing cash with promises or forbidding a positive path', () => {
  const unpaid = renderDecisionDelivery(read(seed()), 2);
  expect(unpaid.calculations.map(c => c.result)).toEqual([{ status: 'available', value: 280 }, { status: 'available', value: -225 }]);
  expect(unpaid.cashFlows[0]).toMatchObject({ shortfall: 225, minimumBalance: -225 });
  expect(unpaid.originalMarkdown).toContain('新增225实际到账'); expect(unpaid.originalMarkdown).toContain('只有书面承诺不改变现金');
  expect(unpaid.markdown).not.toContain('只有书面承诺不改变现金');
  expect(unpaid.markdown).toContain('当前建议：暂缓'); expect(unpaid.markdown).not.toContain('当前建议：wait');
  const paid = renderDecisionDelivery(read(seed(deliveryPurchaseModel(true), deliveryPurchaseAdvice(true))), 2);
  expect(paid.calculations.map(c => c.result)).toEqual([{ status: 'available', value: 505 }, { status: 'available', value: 0 }]);
  expect(paid.cashFlows[0]).toMatchObject({ shortfall: 0 }); expect(paid.options[0].status).toBe('pass');
  expect(paid.markdown).toContain('仍须确认订单条件'); expect(paid.authorization).toBe('not_evaluated');
});
it('does not certify wrong saved prose, and exposes unknown dates and strict same-day funding boundaries', () => {
  const id = seed(deliveryPurchaseModel(), { ...deliveryPurchaseAdvice(), rationale: '错误作者说三份书面承诺就能付款' });
  const output = renderDecisionDelivery(read(id), 2);
  expect(output.markdown).toContain('理由（作者判断）'); expect(output.markdown).toContain('错误作者说三份书面承诺就能付款'); expect(output.cashFlows[0].shortfall).toBe(225);
  expect(output.cashFlows[0].timingThresholds.find(t => t.inputId === 'due')).toMatchObject({ zeroShortfallRanges: [{ lower: 7, upper: null, lowerInclusive: false, upperInclusive: false }] });
  const model = deliveryPurchaseModel(); model.inputs = model.inputs.map(i => i.id === 'received' ? { ...i, value: null } : i);
  const unknown = renderDecisionDelivery(read(seed(model)), 2); expect(unknown.cashFlows[0]).toMatchObject({ status: 'needs_information', shortfall: null });
});
it('rejects outdated recommendations and wrong revisions without adding a record version; unknowns may be delivered conditionally', () => {
  const id = seed(); const before = db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get();
  expect(() => renderDecisionDelivery(read(id), 1)).toThrow('Revision conflict');
  expect(() => createDecisionRecordRepository(db, 'other').read(id)).toThrow('not found');
  expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual(before);
  const bank = deliveryPurchaseModel().inputs[0];
  executeDecisionCommand({ kind: 'update', id, expectedRevision: 2, update: { reason: '现金撤回', inputs: [{ ...bank, value: null, status: 'withdrawn' }] } }, db, 'p');
  expect(() => renderDecisionDelivery(read(id), 3)).toThrow('current inputs');
  const advice: DecisionRecommendation = { ...deliveryPurchaseAdvice(), optionIds: [], conditionalAdvice: { whenNonePass: '不采购', whenUndetermined: '先核对现金' } };
  executeDecisionCommand({ kind: 'recommend', id, expectedRevision: 3, recommendation: advice }, db, 'p');
  const conditional = renderDecisionDelivery(read(id), 4); expect(conditional.originalMarkdown).toContain('已撤回'); expect(conditional.options[0].status).toBe('undetermined');
});
it('writes a linked, byte-exact CLI preview but CLI output never requests termination; cancelled requests publish nothing', async () => {
  const id = seed(); const prepared = decisionPluginCli.prepare({ argv: ['delivery', id, '--expected-revision', '2'], conversationRoot: root, invocationId: 'delivery' });
  if (prepared.status !== 'ready') throw new Error('prepare');
  const context = { projectId: 'p', conversationId: 'c', hostContext: { databaseService: { getDb: () => db } }, signal: new AbortController().signal };
  const output = await prepared.plan.execute(context); expect(output.exitCode).toBe(0);
  const receipt = z.object({ artifact: z.object({ locator: z.string(), markdownLink: z.string() }), originalArtifact: z.object({ locator: z.string(), sha256: z.string() }), deliveryNote: z.string() }).parse(JSON.parse(output.stdout));
  expect(readFileSync(join(root, receipt.artifact.locator.slice('conversation:/'.length)), 'utf8')).toBe(`${renderDecisionDelivery(read(id), 2).markdown}\n---\n\n${receipt.deliveryNote}`);
  const original = readFileSync(join(root, receipt.originalArtifact.locator.slice('conversation:/'.length)), 'utf8');
  expect(original).toBe(renderDecisionDelivery(read(id), 2).originalMarkdown);
  expect(original).toContain('## 输入身份与未知');
  expect(receipt.deliveryNote).toContain(receipt.originalArtifact.locator);
  expect(output.stdout).not.toContain('terminateRun'); expect(receipt.artifact.markdownLink).toContain('conversation:/');
  const files = readdirSync(root); const stop = new AbortController(); stop.abort(new Error('cancelled'));
  await expect(prepared.plan.execute({ ...context, signal: stop.signal })).rejects.toThrow('cancelled'); expect(readdirSync(root)).toEqual(files);
});
it('keeps independent time scenarios and the inclusive endpoint in program delivery', () => {
  const model: DecisionModel = { obligations: [], title: '到场条件', question: '两个出发时刻各何时到场？',
    inputs: [{ id: 'start', label: '出发', value: 510, quantityType: 'day_clock', unit: '当天00:00起分钟', kind: 'fact', status: 'available', origin: '合成' }],
    options: [{ obligationIds: [], id: 'b', label: 'B', description: '路程45分钟' }],
    calculations: [{ id: 'arrival', label: 'B到场', unit: '当天00:00起分钟', quantityType: 'day_clock', expression: { op: 'add', left: { input: 'start' }, right: { literal: 45 } } }],
    checks: [{ id: 'on_time', optionId: 'b', label: '09:30前到场', left: { op: 'add', left: { input: 'start' }, right: { literal: 45 } }, operator: 'lte', right: { literal: 570 } }],
  };
  const advice: DecisionRecommendation = { optionIds: ['b'], rationale: '基线能准时', changeConditions: '改出发时刻后重算', nextAction: '核对行程', unresolved: [], numericBasis: { calculationIds: ['arrival'], boundaries: [{ checkId: 'on_time', inputId: 'start' }] },
    conditionalAdvice: { cases: [{ id: 'boundary', label: '边界', inputs: [{ inputId: 'start', value: 525 }], nextAction: '09:30到场' }, { id: 'late', label: '迟到', inputs: [{ inputId: 'start', value: 526 }], nextAction: '另找安排' }], whenNonePass: '改计划', whenUndetermined: '核对信息' } };
  const output = renderDecisionDelivery(read(seed(model, advice)), 2);
  const boundary = output.markdown.split('### 边界')[1].split('### 迟到')[0];
  const late = output.markdown.split('### 迟到')[1];
  expect(boundary).toContain('570（09:30）'); expect(boundary).not.toContain('555（09:15）');
  expect(late).toContain('571（09:31）'); expect(late).not.toContain('570（09:30）');
  expect(output.markdown).toContain('≤ 525'); expect(late).toContain('下一步（作者建议）：另找安排');
  expect(output.markdown).not.toContain('--- |'); expect(output.originalMarkdown).toContain('--- |');
});
