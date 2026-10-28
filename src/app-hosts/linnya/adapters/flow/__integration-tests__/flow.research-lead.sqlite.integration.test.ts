import { createProjectLifecycle } from 'src/domains/projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResearchRunArgsSchema,
  SubagentResultSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import {
  readSubrunTrace,
  readTail,
} from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { RegisteredChildRunInvoker } from '../../child-runs/registeredSubagentInvoker';
import { toolRegistry } from '../../tools/toolRegistry';
import type { ToolContext } from 'src/tools/types';

const conversationId = 'lead-research-conversation';
const modelId = 'scripted-test-model';
const paths = {
  source: 'workspace:/source.md',
  investigation: 'workspace:/investigation.md',
  draft: 'workspace:/draft.md',
  argument_review: 'workspace:/argument-review.md',
  source_review: 'workspace:/source-review.md',
  revision: 'workspace:/revision.md',
};
const scope = ResearchRunArgsSchema.parse({
  question: 'Explain the observed change without inventing its cause.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: [paths.source],
});
const report =
  'The supplied value rose from 100 to 110, a 10% change. Its cause is not identified.';
const finalAnswer = `Revised article: [Article](${paths.revision}). The cause remains unresolved.`;
type Reviewer = 'argument_review' | 'source_review';
type ModelCall = Parameters<NonNullable<ScriptedLlmTurn['assertCall']>>[0];
let directory: string;
const closers: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-research-lead-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture({ supported_efforts: ['low', 'high'], default_effort: 'low' });
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closers.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function open(turns: ScriptedLlmTurn[]) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns);
  closers.push(fixture.close);
  return fixture;
}
type Fixture = Awaited<ReturnType<typeof open>>;
async function close(fixture: Fixture) {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.close();
  closers.pop();
  resetAgentRuntimeSingletonsForTest();
}
async function seed(fixture: Fixture) {
  const projectId = createProjectLifecycle(fixture.db).create({ name: 'Lead acceptance' });
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  // 夹具也经通用 Workspace 写入，不再借用已撤回的研究提交/回执 owner。
  const writer = toolRegistry.getTool('write_file');
  if (!writer) throw new Error('Missing Workspace writer');
  const context: ToolContext = {
    databaseService: fixture.database,
    workspaceService: new WorkspaceService(fixture.db),
    workspaceProjectId: projectId,
    conversationId,
  };
  const written = await writer.run(
    {
      locator: paths.source,
      content: '# Source\n\nBaseline is 100; current is 110.',
    },
    context
  );
  expect(WorkspaceWriteFileResultSchema.parse(JSON.parse(written)).data.locator).toBe(paths.source);
  return projectId;
}
async function start(fixture: Fixture, projectId: string) {
  await fixture.flow.next(
    {
      conversation_id: conversationId,
      project_id: projectId,
      new_events: [{ type: 'user_input', content: scope.question, source: 'user', timestamp: 1 }],
      options: {
        promptKey: 'research_v1',
        model_id: modelId,
        reasoning_effort: 'high',
        research_scope: scope,
        project_metadata: { id: projectId, name: 'Lead acceptance' },
      },
    },
    () => {}
  );
}
async function facts(fixture: Fixture) {
  return (
    await fixture.eventStore.readEvents(conversationId, {
      limit: 1000,
      routingScope: 'foreground-conversation',
    })
  ).events;
}
function userText(call: ModelCall): string {
  return call.messages
    .filter(message => message.role === 'user')
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}
function assertTools(call: ModelCall, child: boolean) {
  expect(call.modelId).toBe(modelId);
  expect(call.options.reasoning_effort).toBe('high');
  const exposed = call.options.tools?.map(item => item.name) ?? [];
  for (const name of ['read_file', 'write_file', 'edit_file']) expect(exposed).toContain(name);
  for (const name of ['research_run', 'complete_research', 'submit_research_document'])
    expect(exposed).not.toContain(name);
  expect(exposed.includes('subagent')).toBe(!child);
}
function tool(id: string, name: string, args: Record<string, unknown>) {
  return { id, name, argumentsJson: JSON.stringify(args) };
}
function assignment(role: Reviewer | 'investigation'): ScriptedLlmTurn {
  const prompt =
    role === 'investigation'
      ? `Investigate only ${paths.source}. Do not browse the web. Save findings to ${paths.investigation}; disclose missing material.`
      : [
          `Review target: ${paths.draft}. Review this document only.`,
          `Supporting evidence: ${paths.source} and ${paths.investigation}. These are not alternative drafts.`,
          'Use the fixed materials only; do not browse the web or read other review reports. Report missing evidence to the lead.',
          `Save your independent ${role} to ${paths[role]}. Do not edit the draft.`,
        ].join('\n');
  return {
    toolCalls: [
      tool(`delegate-${role}`, 'subagent', {
        description: role,
        prompt,
        subagent_type: `research_${role}`,
      }),
    ],
    assertCall(call) {
      assertTools(call, false);
    },
  };
}
function reviewerTurns(role: Reviewer): ScriptedLlmTurn[] {
  return [
    {
      toolCalls: [
        tool(`${role}-read-draft`, 'read_file', { locator: paths.draft }),
        tool(`${role}-read-source`, 'read_file', { locator: paths.source }),
      ],
      assertCall(call) {
        assertTools(call, true);
        // 只验证实际送达的父任务与实际读取，不把任务约束宣称为文件权限。
        const prompt = userText(call);
        expect(prompt).toContain(`Review target: ${paths.draft}.`);
        expect(prompt).toContain(`Supporting evidence: ${paths.source}`);
        expect(prompt).toContain('do not browse the web or read other review reports');
        const other = role === 'argument_review' ? paths.source_review : paths.argument_review;
        expect(prompt).not.toContain(other);
      },
    },
    {
      toolCalls: [
        tool(`${role}-save`, 'write_file', {
          locator: paths[role],
          content: `# ${role}\n\n${report}`,
        }),
      ],
      assertCall(call) {
        const readResults = call.messages.filter(message => message.role === 'tool');
        expect(readResults.some(message => message.tool_call_id === `${role}-read-draft`)).toBe(
          true
        );
        expect(readResults.some(message => message.tool_call_id === `${role}-read-source`)).toBe(
          true
        );
      },
    },
    { contentChunks: [`Saved [review](${paths[role]}). The evidence does not identify a cause.`] },
  ];
}
function beforeFirstReview(): ScriptedLlmTurn[] {
  return [
    { toolCalls: [tool('lead-read-source', 'read_file', { locator: paths.source })] },
    {
      toolCalls: [
        tool('lead-save-investigation', 'write_file', {
          locator: paths.investigation,
          content: `# Investigation\n\n${report}`,
        }),
        tool('lead-save-draft', 'write_file', {
          locator: paths.draft,
          content: `# Draft\n\n${report}`,
        }),
      ],
      assertCall(call) {
        assertTools(call, false);
      },
    },
    assignment('argument_review'),
    ...reviewerTurns('argument_review'),
  ];
}
function afterFirstReview(): ScriptedLlmTurn[] {
  return [
    assignment('source_review'),
    ...reviewerTurns('source_review'),
    {
      toolCalls: [
        tool('lead-read-argument-review', 'read_file', { locator: paths.argument_review }),
        tool('lead-read-source-review', 'read_file', { locator: paths.source_review }),
      ],
    },
    {
      toolCalls: [
        tool('lead-save-revision', 'write_file', {
          locator: paths.revision,
          content: `# Revised article\n\n${report}`,
        }),
      ],
    },
    {
      toolCalls: [
        tool('lead-refine-revision', 'edit_file', {
          locator: paths.revision,
          old_string: 'Its cause is not identified.',
          new_string: 'The source does not distinguish competing causes.',
        }),
      ],
    },
    { contentChunks: [finalAnswer] },
  ];
}
function chain(): ScriptedLlmTurn[] {
  return [...beforeFirstReview(), ...afterFirstReview()];
}
async function assertDelivered(fixture: Fixture, projectId: string) {
  const events = await facts(fixture);
  const outputs = events.filter(event => event.type === 'tool_output');
  expect(outputs.every(event => event.status === 'success')).toBe(true);
  const parentWrites = outputs.filter(event => event.tool_name === 'write_file');
  expect(
    parentWrites.map(
      event =>
        WorkspaceWriteFileResultSchema.parse({
          data: event.data,
          observation: event.observation,
        }).data.locator
    )
  ).toEqual([paths.investigation, paths.draft, paths.revision]);
  const final = events.find(event => event.type === 'final_answer');
  if (!final || final.type !== 'final_answer') throw new Error('Missing parent final answer');
  expect(final.content).toBe(finalAnswer);
  const children = (
    await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(final.run_id) })
  ).runs;
  expect(children).toHaveLength(2);
  expect(children.every(child => child.status === 'completed')).toBe(true);
  const delegations = outputs.filter(event => event.tool_name === 'subagent');
  expect(delegations).toHaveLength(2);
  for (const [index, delegation] of delegations.entries()) {
    const result = SubagentResultSchema.parse({
      data: delegation.data,
      observation: delegation.observation,
    });
    expect(result.data.status).toBe('completed');
    expect(result.data.artifacts).toHaveLength(1);
    const role: Reviewer = index === 0 ? 'argument_review' : 'source_review';
    expect(result.data.final_answer).toContain(paths[role]);
    const trace = readSubrunTrace(
      fixture.db,
      conversationId,
      delegation.tool_call_id,
      result.data.subrun_ids[0]
    );
    if (trace.status !== 'ready') throw new Error('Missing delegation trace');
    expect(trace.events.some(event => event.kind === 'final_answer')).toBe(true);
    // 子运行自己的完整事实证明来源读取和产物写入；父 tool result 不是读过原文的证据。
    const child = children.find(item => item.runId === result.data.subrun_ids[0]);
    if (!child) throw new Error('Missing child registration');
    const childEvents = (
      await fixture.eventStore.readEvents(conversationId, { limit: 1000 })
    ).events.filter(event => event.run_id === child.runId);
    const childOutputs = childEvents.filter(event => event.type === 'tool_output');
    expect(childOutputs.map(event => event.tool_name)).toEqual([
      'read_file',
      'read_file',
      'write_file',
    ]);
    expect(childOutputs.every(event => event.status === 'success')).toBe(true);
  }
  const reader = toolRegistry.getTool('read_file');
  if (!reader) throw new Error('Missing Workspace reader');
  const context: ToolContext = {
    databaseService: fixture.database,
    workspaceService: new WorkspaceService(fixture.db),
    workspaceProjectId: projectId,
    conversationId,
  };
  const revision = await reader.run({ locator: paths.revision }, context);
  expect(revision).toContain('The source does not distinguish competing causes.');
  expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(6);
  expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  fixture.ai.assertAllTurnsConsumed();
  return final.run_id;
}

describe('Lead research through ordinary Workspace tools and prompt delegation', () => {
  it('父写初稿与修订，双复核各自读稿并写报告，重载保留独立轨迹和最终链接', async () => {
    const fixture = await open(chain());
    const projectId = await seed(fixture);
    await start(fixture, projectId);
    const parentRunId = await assertDelivered(fixture, projectId);
    expect(fixture.ai.getCalls()).toHaveLength(chain().length);
    const before = readTail(fixture.db, conversationId, 100);
    await close(fixture);
    const reloaded = await open([]);
    const after = readTail(reloaded.db, conversationId, 100);
    expect(after).toEqual(before);
    expect((await reloaded.runtime.supervisor.peek(RunIdSchema.parse(parentRunId)))?.status).toBe(
      'completed'
    );
  });
  it('child完成但父工具尚未接纳时恢复原委派，不重复模型调用或文档', async () => {
    const first = await open(beforeFirstReview());
    const projectId = await seed(first);
    const original = RegisteredChildRunInvoker.prototype.invoke;
    const interception = vi
      .spyOn(RegisteredChildRunInvoker.prototype, 'invoke')
      .mockImplementation(async function (this: RegisteredChildRunInvoker, call) {
        await original.call(this, call);
        throw new graph.RunRecoveryBlockedError(
          'Interrupted after child completion before parent acceptance'
        );
      });
    await start(first, projectId);
    const root = (await first.flow.getActiveForegroundRun(conversationId)).run;
    if (!root || root.status !== 'paused' || !root.pause?.settled || !root.execution_id)
      throw new Error('Expected settled pause');
    const originalChildren = (
      await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
    ).runs;
    expect(originalChildren).toHaveLength(1);
    expect(originalChildren[0]?.status).toBe('completed');
    expect(new WorkspaceService(first.db).getChildNodes(null, projectId)).toHaveLength(4);
    first.ai.assertAllTurnsConsumed();
    interception.mockRestore();
    await close(first);
    const resumed = await open(afterFirstReview());
    const current = (await resumed.flow.getActiveForegroundRun(conversationId)).run;
    if (!current || current.status !== 'paused' || !current.pause?.settled || !current.execution_id)
      throw new Error('Missing recovered pause');
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: current.execution_id,
        expected_updated_at: current.pause.updated_at,
      },
      () => {}
    );
    await assertDelivered(resumed, projectId);
    expect(resumed.ai.getCalls()).toHaveLength(afterFirstReview().length);
    expect(
      (
        await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
      ).runs.map(item => item.runId)
    ).toContain(originalChildren[0]?.runId);
  });
  it('固定材料是任务要求，普通完成不认证产物；无文件的child可由父如实说明不足', async () => {
    const fixture = await open([
      assignment('investigation'),
      {
        contentChunks: ['No findings document was saved; the material does not identify a cause.'],
        assertCall(call) {
          assertTools(call, true);
          expect(userText(call)).toContain('Do not browse the web.');
          // 不以研究任务改写公共工具权限：是否遵守固定材料范围必须从实际调用审计。
          expect(call.options.tools?.map(item => item.name)).toContain('web_search');
        },
      },
      { contentChunks: ['No document was saved; the research article has not been delivered.'] },
    ]);
    const projectId = await seed(fixture);
    await start(fixture, projectId);
    const events = await facts(fixture);
    const delegation = events.find(
      event => event.type === 'tool_output' && event.tool_name === 'subagent'
    );
    if (!delegation || delegation.type !== 'tool_output') throw new Error('Missing child result');
    expect(
      SubagentResultSchema.parse({ data: delegation.data, observation: delegation.observation })
        .data
    ).toMatchObject({ status: 'completed', artifacts: [] });
    expect(
      events.filter(event => event.type === 'final_answer').map(event => event.content)
    ).toEqual(['No document was saved; the research article has not been delivered.']);
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
  });
  it('取消传播到实际child，未执行的写入不落盘，重启不自动重新委派', async () => {
    const fixture = await open([
      assignment('investigation'),
      {
        toolCalls: [
          tool('child-pending-save', 'write_file', {
            locator: paths.investigation,
            content: '# Pending',
          }),
        ],
      },
    ]);
    const projectId = await seed(fixture);
    const writer = toolRegistry.getTool('write_file');
    if (!writer) throw new Error('Missing Workspace writer');
    let reached!: () => void;
    const ready = new Promise<void>(resolve => {
      reached = resolve;
    });
    vi.spyOn(writer, 'run').mockImplementation(async (_args, context) => {
      const signal = context.abortSignal;
      if (!signal) throw new Error('Missing child cancellation signal');
      reached();
      await new Promise<void>(resolve =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      );
      signal.throwIfAborted();
      throw new Error('Cancellation must abort the child');
    });
    const pending = start(fixture, projectId);
    await ready;
    const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!root) throw new Error('Missing active root');
    await fixture.flow.cancelRun(root.run_id, conversationId, 'User cancelled research');
    await pending;
    const children = (
      await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
    ).runs;
    expect(children).toHaveLength(1);
    expect(children[0]?.status).toBe('cancelled');
    expect((await fixture.runtime.supervisor.peek(RunIdSchema.parse(root.run_id)))?.status).toBe(
      'cancelled'
    );
    expect(new WorkspaceService(fixture.db).getChildNodes(null, projectId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
    await close(fixture);
    const resumed = await open([]);
    expect((await resumed.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    expect(
      (await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })).runs
    ).toHaveLength(1);
  });
});
