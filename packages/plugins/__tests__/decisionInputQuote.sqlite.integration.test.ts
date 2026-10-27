import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { RunInputQuote } from '@app/schemas';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { BaseTool, type ToolContext } from 'src/tools/types';
import { readCurrentRunInputQuote } from 'src/plugin-sdk/backend/runInputQuote';
import { createDurableFlowHarness, installRecoveryModelFixture } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDurableFlowHarness';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { decisionPluginCli } from '../decision/src/backend/features/decision-cli/orchestration/prepareDecisionCli';
import { executeDecisionCommand } from '../decision/src/backend/features/decision-cli/orchestration/executeDecisionCommand';
import { decisionMigrations } from '../decision/src/backend/features/decision-record/persistence/migrations';
import { DecisionRecordSchema } from '../decision/src/shared';
import { remoteOfferModel } from '../decision/src/backend/__tests__/fixtures/remoteOffer';

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>>;
let projectId: string;
let decisionId: string;
let actionId: string;
let captured: RunInputQuote | undefined;
let operation: (context: ToolContext) => Promise<void>;
const conversationId = 'input-quote-root';
const original = '我只问了第一位。\n对方愿意补到100元，但没有实际补款。';
const toolTurn: ScriptedLlmTurn = { toolCalls: [{ id: 'report', name: 'shell', argumentsJson: '{}' }] };
class InputBridge extends BaseTool {
  readonly name = 'shell'; readonly description = 'Admitted CLI fixture';
  readonly parameters = { type: 'object' as const, properties: {} };
  async run(_args: Record<string, unknown>, context: ToolContext) { await operation(context); return 'Recorded'; }
}
function identity(context: ToolContext) {
  return { hostContext: context, conversationId, projectId, agentRunId: context.runId, signal: context.abortSignal ?? new AbortController().signal };
}
async function open(turns: ScriptedLlmTurn[]) {
  fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns, [new InputBridge()]);
}
async function start(content: string) {
  await fixture.flow.next({ conversation_id: conversationId, project_id: projectId,
    new_events: [{ type: 'user_input', content, source: 'user', timestamp: 1 }],
    options: { promptKey: 'default', model_id: 'scripted-test-model', reasoning_effort: 'low' },
  }, () => {});
}
function record(revision?: number) {
  const output = executeDecisionCommand({ kind: 'read', id: decisionId, revision }, fixture.db, projectId);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected record');
  return DecisionRecordSchema.parse(output.record);
}
async function report(context: ToolContext, kind: 'resolve' | 'withdraw', quote: string, expected: number) {
  const payload = kind === 'resolve'
    ? { outcome: 'completed', summary: '一人表达意向，没有补款', origin: '用户角色输入', actualCost: '3分钟', sourceQuote: quote }
    : { reason: '误读对方意向', origin: '本轮更正', sourceQuote: quote };
  const prepared = decisionPluginCli.prepare({ argv: ['action', kind, decisionId, actionId, '--expected-revision', String(expected), '--json', JSON.stringify(payload)], conversationRoot: directory, invocationId: 'report' });
  if (prepared.status !== 'ready') throw new Error('Expected plan');
  return prepared.plan.execute(identity(context));
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-input-quote-')); captured = undefined;
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture?.close(); resetAgentRuntimeSingletonsForTest(); rmSync(directory, { recursive: true, force: true });
});
async function seed() {
  projectId = new WorkspaceService(fixture.db).createProject('Source quote scope');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  for (const migration of decisionMigrations) migration.up(fixture.db);
  const output = executeDecisionCommand({ kind: 'create', model: remoteOfferModel() }, fixture.db, projectId);
  if (typeof output !== 'object' || output === null || !('record' in output)) throw new Error('Expected created record');
  decisionId = DecisionRecordSchema.parse(output.record).id;
  executeDecisionCommand({ kind: 'action_plan', id: decisionId, expectedRevision: 1,
    plan: { label: '询问', purpose: '确认事实', inputIds: [], executor: 'user', estimatedCost: '3分钟' } }, fixture.db, projectId);
  const action = record().actions?.[0]; if (!action) throw new Error('Expected action'); actionId = action.id;
}
it('uses admitted root input, rejects forged/scope-mismatched quotes atomically, and preserves separate report/correction proofs', async () => {
  await open([toolTurn, { contentChunks: ['完成'] }, { toolCalls: [{ id: 'correction', name: 'shell', argumentsJson: '{}' }] }, { contentChunks: ['已更正'] }]); await seed();
  operation = async context => {
    const id = identity(context);
    captured = await readCurrentRunInputQuote(id, '我只问了第一位。 对方愿意补到100元');
    expect(captured.textSha256).toBe(createHash('sha256').update(original).digest('hex'));
    await expect(readCurrentRunInputQuote({ ...id, conversationId: 'other' }, '第一位')).rejects.toThrow();
    await expect(readCurrentRunInputQuote({ ...id, projectId: 'other' }, '第一位')).rejects.toThrow();
    await expect(readCurrentRunInputQuote({ ...id, agentRunId: 'missing' }, '第一位')).rejects.toThrow();
    await expect(readCurrentRunInputQuote(id, ' '.repeat(2))).rejects.toThrow();
    await expect(readCurrentRunInputQuote(id, '我'.repeat(2001))).rejects.toThrow();
    const before = record();
    expect((await report(context, 'resolve', '三位均已支付全款', 2)).exitCode).toBe(3);
    expect(record()).toEqual(before);
    expect((await report(context, 'resolve', '对方愿意补到100元，但没有实际补款。', 2)).exitCode).toBe(0);
  };
  await start(original);
  expect(record().actions?.[0]?.result?.provenance).toMatchObject({ kind: 'conversation_input_quote', input: { conversationId, inputEventId: captured?.inputEventId, textSha256: captured?.textSha256 } });
  const saved = record();
  const correction = '更正：对方只问能否保持50元，并未答应补款。';
  operation = async context => {
    await expect(readCurrentRunInputQuote(identity(context), '愿意补到100元')).rejects.toThrow('Quote not found');
    expect((await report(context, 'withdraw', correction, 3)).exitCode).toBe(0);
  };
  // 新turn独立接纳；旧事件仍在历史，但不成为本次引语的候选。
  await start(correction); fixture.ai.assertAllTurnsConsumed();
  expect(record().actions?.[0]?.result?.provenance).toEqual(saved.actions?.[0]?.result?.provenance);
  expect(record().actions?.[0]?.result?.withdrawal?.provenance).toMatchObject({ kind: 'conversation_input_quote', input: { quote: correction } });
  expect(record(3)).toEqual(saved);
});
it('reopens a paused run and binds the original admitted input; persisted proof survives terminal cleanup', async () => {
  operation = async context => { captured = await readCurrentRunInputQuote(identity(context), '没有实际补款'); };
  await open([toolTurn, { throwAfterEvents: new Error('Synthetic transport pause') }]); await seed(); await start(original);
  const before = captured;
  const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!active?.pause?.settled || !active.execution_id) throw new Error('Expected settled pause');
  await new Promise(resolve => setTimeout(resolve, 0)); fixture.close(); resetAgentRuntimeSingletonsForTest();
  await open([{ toolCalls: [{ id: 'resumed-report', name: 'shell', argumentsJson: '{}' }] }, { contentChunks: ['恢复完成'] }]);
  operation = async context => {
    expect(await readCurrentRunInputQuote(identity(context), '没有实际补款')).toEqual(before);
    expect((await report(context, 'resolve', '没有实际补款', 2)).exitCode).toBe(0);
  };
  const resumed = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!resumed?.pause?.settled || !resumed.execution_id) throw new Error('Expected reopened run');
  await fixture.flow.continueRun(resumed.run_id, { conversation_id: conversationId, expected_execution_id: resumed.execution_id, expected_updated_at: resumed.pause.updated_at }, () => {});
  fixture.ai.assertAllTurnsConsumed();
  expect(record().actions?.[0]?.result?.provenance).toMatchObject({ kind: 'conversation_input_quote', input: before });
});
