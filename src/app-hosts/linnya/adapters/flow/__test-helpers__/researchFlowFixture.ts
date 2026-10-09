import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  ResearchRunStructuredResultSchema,
  ResearchRunArgsSchema,
  type ConversationNextRequest,
  type ResearchRunArgs,
} from '@app/schemas';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';
import { clearRegisteredAgentTaskCache } from '../../../agent-registry/agentTaskResolver';
import { toolRegistry } from '../../tools/toolRegistry';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
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
import { createWorkspaceResearchDocumentPort } from '../../research-documents';
import { SqliteResearchStageReceiptStore } from '../../persistence/research-stage-receipts';
import {
  readSubrunTrace,
  readTail,
} from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type { ResearchExecutionIdentity } from '../../../application/research';

export const conversationId = 'legacy-research-recovery-conversation';
export const modelId = 'scripted-test-model';
export const input = ResearchRunArgsSchema.parse({
  question: 'Explain the change and distinguish observation from an unverified cause.',
  reader: 'General reader',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
});
export const stages = [
  'investigation',
  'investigation_review',
  'draft',
  'argument_review',
  'source_review',
  'revision',
] as const;
let directory: string;
const closers: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-legacy-research-recovery-'));
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
  clearRegisteredAgentTaskCache();
  rmSync(directory, { recursive: true, force: true });
});

export async function open(turns: ScriptedLlmTurn[]) {
  // 不注入测试工具或替换研究用例：正式 registry 负责装饰、执行与 returned receipt。
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns);
  closers.push(fixture.close);
  return fixture;
}
export type Fixture = Awaited<ReturnType<typeof open>>;
export async function close(fixture: Fixture) {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.close();
  closers.pop();
  resetAgentRuntimeSingletonsForTest();
}
export function turns(count: number): ScriptedLlmTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    toolCalls: [
      {
        id: `submit-${index}`,
        name: 'submit_research_document',
        argumentsJson: JSON.stringify({
          content:
            '# Synthetic research\n\nThe supplied baseline is 100 and the current value is 110. The change alone does not establish its cause.',
        }),
      },
    ],
    assertCall(call) {
      expect(call.modelId).toBe(modelId);
      expect(call.options.reasoning_effort).toBe('high');
      expect(JSON.stringify(call.messages)).toContain('# Research stage:');
      const exposed = call.options.tools?.map(tool => tool.name) ?? [];
      expect(exposed).toContain('read_file');
      expect(exposed).toContain('skill');
      for (const prohibited of [
        'write_file',
        'edit_file',
        'research_run',
        'subagent',
        'subrun_batch',
      ]) {
        expect(exposed).not.toContain(prohibited);
      }
    },
  }));
}
export async function seed(fixture: Fixture) {
  const projectId = new WorkspaceService(fixture.db).createProject('Research acceptance');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  await fixture.eventStore.ensureConversation('material-seed', [], projectId, 'agent');
  await fixture.eventStore.beginRunSession('material-seed', 'material-seed-run', { kind: 'agent' });
  await createWorkspaceResearchDocumentPort({
    db: fixture.db,
    eventStore: fixture.eventStore,
  }).save({
    projectId,
    conversationId: 'material-seed',
    sourceRunId: 'material-seed-run',
    path: 'workspace:/source.md',
    text: '# Source\n\nBaseline is 100; current is 110.',
    receipt: { prepare() {}, commit() {} },
  });
  return projectId;
}
export function request(projectId: string, explicit = true): ConversationNextRequest {
  return {
    conversation_id: conversationId,
    project_id: projectId,
    new_events: [{ type: 'user_input', content: input.question, source: 'user', timestamp: 1 }],
    options: {
      promptKey: 'research_v1',
      model_id: modelId,
      reasoning_effort: 'high',
      project_metadata: { id: projectId, name: 'Research acceptance' },
      ...(explicit ? { research_scope: input } : {}),
    },
  };
}
/**
 * 仅生成旧版本已接纳的恢复事实，在父工具执行前停下；业务测试从正式 continue 开始。
 * 不能把旧 host_tool_call 当作当前研究入口，也不能让构造夹具时执行任何研究阶段。
 */
export async function runLegacyResearch(
  fixture: Fixture,
  projectId: string,
  scope: ResearchRunArgs = input
) {
  const findDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey;
  const legacyDefinition = vi
    .spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey')
    .mockImplementation(key => {
      const definition = findDefinition(key);
      return key === 'research_v1' && definition
        ? {
            ...definition,
            requestAdmission: undefined,
            config: {
              availableTools: [],
              enableTools: false,
              modelPolicy: { kind: 'user_primary' },
            },
            hostEntry: { toolName: 'research_run', resolveArgs: () => scope },
            task: {
              systemPromptBuilder: () =>
                'Legacy admitted Host research entry; resume its frozen tool request.',
            },
          }
        : definition;
    });
  const tool = toolRegistry.getTool('research_run');
  if (!tool) throw new Error('Missing legacy research tool');
  const beforeExecution = vi
    .spyOn(tool, 'run')
    .mockRejectedValueOnce(
      new graph.RunRecoveryBlockedError('Legacy fixture accepted before first research stage')
    );
  clearRegisteredAgentTaskCache();
  try {
    await fixture.flow.next(request(projectId, false), () => {});
  } finally {
    beforeExecution.mockRestore();
    legacyDefinition.mockRestore();
    clearRegisteredAgentTaskCache();
  }
  const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!root || root.status !== 'paused' || !root.pause?.settled)
    throw new Error('Legacy descriptor was not admitted at a recoverable boundary');
  const descriptor = await fixture.runtime.runDescriptors?.load(root.run_id);
  expect(descriptor?.request.promptKey).toBe('research_v1');
  expect(descriptor?.request.researchScope).toBeUndefined();
  expect(descriptor?.options?.host_tool_call).toEqual({
    tool_name: 'research_run',
    args: scope,
    completion_mode: 'yield_after_batch',
  });
  expect(
    (await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })).runs
  ).toEqual([]);
  expect(fixture.ai.getConsumedTurnCount()).toBe(0);
  await continueRoot(fixture);
}

export async function facts(fixture: Fixture) {
  return (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
}
export async function identity(
  fixture: Fixture,
  projectId: string
): Promise<ResearchExecutionIdentity> {
  const decision = (await facts(fixture)).find(
    event => event.type === 'tool_call_decision' && event.tool_name === 'research_run'
  );
  if (!decision || decision.type !== 'tool_call_decision')
    throw new Error('Missing research entry');
  return {
    parentRunId: decision.run_id,
    toolCallId: decision.tool_call_id,
    conversationId,
    projectId,
    modelId,
  };
}
export async function children(fixture: Fixture, owner: ResearchExecutionIdentity) {
  return (
    await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(owner.parentRunId) })
  ).runs;
}
export async function continueRoot(fixture: Fixture) {
  const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!root || root.status !== 'paused' || !root.pause?.settled || !root.execution_id)
    throw new Error('Expected a settled recoverable root');
  await fixture.flow.continueRun(
    root.run_id,
    {
      conversation_id: conversationId,
      expected_execution_id: root.execution_id,
      expected_updated_at: root.pause.updated_at,
    },
    () => {}
  );
}
export async function assertDelivered(fixture: Fixture, owner: ResearchExecutionIdentity) {
  const runs = await children(fixture, owner);
  expect(runs).toHaveLength(6);
  expect(runs.every(run => run.status === 'completed')).toBe(true);
  const events = await facts(fixture);
  const outputs = events.filter(
    event => event.type === 'tool_output' && event.tool_name === 'research_run'
  );
  expect(outputs).toHaveLength(1);
  const output = outputs[0];
  if (!output || output.type !== 'tool_output') throw new Error('Missing research result');
  expect(output.status).toBe('success');
  const result = ResearchRunStructuredResultSchema.parse({
    data: output.data,
    observation: output.observation,
  });
  expect(result.data.status).toBe('delivered');
  expect(result.data.artifacts.map(artifact => artifact.stage)).toEqual(stages);
  const receipts = new SqliteResearchStageReceiptStore(fixture.db).list(owner);
  const documents = createWorkspaceResearchDocumentPort({
    db: fixture.db,
    eventStore: fixture.eventStore,
  });
  for (const artifact of result.data.artifacts) {
    expect(artifact.subrun_id).toBe(`${owner.toolCallId}_${artifact.stage}`);
    const saved = await documents.read({ projectId: owner.projectId, inode: artifact.inode });
    expect(saved.sha256).toBe(artifact.sha256);
    expect(saved.citationSha256).toBe(artifact.citation_sha256);
    expect(saved.text).toContain('does not establish its cause');
    const trace = readSubrunTrace(fixture.db, conversationId, owner.toolCallId, artifact.subrun_id);
    if (trace.status !== 'ready') throw new Error('Missing research child trace');
    expect(trace.events.filter(event => event.kind === 'final_answer')).toHaveLength(1);
  }
  for (const stage of ['argument_review', 'source_review']) {
    const receipt = receipts.find(item => item.stage === stage);
    expect(receipt?.inputs).toHaveLength(receipt?.invocation.task_type === 'fixed' ? 4 : 3);
    expect(
      receipt?.inputs.some(binding => /argument_review|source_review/.test(binding.locator))
    ).toBe(false);
  }
  expect(new WorkspaceService(fixture.db).getChildNodes(null, owner.projectId)).toHaveLength(7);
  expect(
    events.filter(
      event => event.type === 'tool_call_decision' && event.tool_name === 'research_run'
    )
  ).toHaveLength(1);
  expect(
    events.filter(event => event.type === 'final_answer' && event.run_id === owner.parentRunId)
  ).toHaveLength(1);
  const projection = readTail(fixture.db, conversationId, 100);
  if (projection.status !== 'ready') throw new Error('Missing reloaded research projection');
  expect(projection.messages.filter(message => message.message_type === 'tool_calls')).toHaveLength(
    1
  );
  expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  fixture.ai.assertAllTurnsConsumed();
}
