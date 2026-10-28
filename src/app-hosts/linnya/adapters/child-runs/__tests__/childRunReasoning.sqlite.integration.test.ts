import { createProjectLifecycle } from 'src/domains/projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema, runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import { execution, graph, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { modelCatalog, type ModelConfig } from 'src/domains/model-catalog';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { RunDescriptorSchema } from '../../../application/run-resumption';
import { captureRuntimeCompatibility } from '../../../application/run-resumption/functions/runtimeCompatibility';
import { findRegisteredAgentDefinitionByPromptKey } from '../../../agent-registry/agentDefinitionResolver';
import type { AgentDefinition } from '../../../agent-registry/types';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../../flow/__test-helpers__/createDurableFlowHarness';
import { runnableDefinitionToAgentSpec } from '../../runtime/agentDefinitionToAgentSpec';
import { createLinnyaChildRunInvoker, toChildRunAgentConfig } from '../childRunInvokerFactory';
import { createRegisteredChildRunInvoker } from '../registeredSubagentInvoker';

const conversationId = 'child-reasoning-conversation';
const parentRunId = RunIdSchema.parse('child-reasoning-parent');
const subrunId = 'child-reasoning';
const childRunId = runIdFromSubrunId(subrunId);
const parentModelId = 'scripted-test-model';
const fixedModelId = 'fixed-other-model';
let directory: string;
const closers: Array<() => void> = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-child-reasoning-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture({ supported_efforts: ['low', 'high'], default_effort: 'high' });
  const model = modelCatalog.getModel(parentModelId);
  if (!model) throw new Error('Missing scripted parent model');
  const fixedModel: ModelConfig = {
    ...model,
    id: fixedModelId,
    model_name: fixedModelId,
    reasoning: { supported_efforts: ['high'], default_effort: 'high' },
  };
  vi.mocked(modelCatalog.getModel).mockImplementation(id =>
    id === parentModelId ? model : id === fixedModelId ? fixedModel : undefined
  );
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

async function seedParent(fixture: Fixture, projectId?: string) {
  const definition = findRegisteredAgentDefinitionByPromptKey('default');
  if (!definition) throw new Error('Missing parent definition');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  const descriptor = RunDescriptorSchema.parse({
    schemaVersion: 1,
    runId: parentRunId,
    conversationId,
    turnId: 'parent-reasoning-turn',
    createdAt: 1,
    agentSpec: runnableDefinitionToAgentSpec(definition),
    request: {
      query: 'Parent request',
      promptKey: 'default',
      model_id: parentModelId,
      reasoning_effort: 'low',
      frozenSystemPrompt: 'Frozen parent',
      ...(projectId ? { project_metadata: { id: projectId, name: 'Synthetic child inputs' } } : {}),
    },
    historyEventIds: [],
    incomingEventIds: [],
    runContext: { runId: parentRunId, traceId: 'child-reasoning-trace', tags: {} },
    toolContextPatch: {},
    executorLocal: {},
    commandPermission: {
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'run_snapshot_missing',
    },
    compatibility: captureRuntimeCompatibility('default', parentModelId),
  });
  const admission = fixture.runtime.runAdmissionCommit;
  if (!admission) throw new Error('Missing durable admission');
  const eventBus = new execution.EventBus(
    new execution.EventSequencer(conversationId).getExecutionId()
  );
  try {
    await fixture.runtime.supervisor.registerRun({
      runId: parentRunId,
      conversationId,
      agentSpec: descriptor.agentSpec,
      request: descriptor.request,
      eventBus,
      eventStore: fixture.runtime.eventStore,
      costCollector: fixture.runtime.costCollector,
      admissionCommit: record =>
        admission.start({
          record,
          descriptor,
          incoming: { events: [], assetCommitsByEventId: new Map() },
        }),
    });
  } finally {
    eventBus.close();
  }
}

function invoker(fixture: Fixture, options: {
  fixed?: boolean;
  promptKey?: string;
  requestAdmission?: AgentDefinition['requestAdmission'];
} = {}) {
  const definition = findRegisteredAgentDefinitionByPromptKey(options.promptKey ?? 'research_author_v1');
  if (!definition) throw new Error('Missing registered child definition');
  const childDefinition: AgentDefinition = {
    ...definition,
    ...(options.requestAdmission ? { requestAdmission: options.requestAdmission } : {}),
    config: {
      ...definition.config,
      availableTools: [],
      modelPolicy: options.fixed ? { kind: 'fixed', modelId: fixedModelId } : { kind: 'inherit_parent' },
    },
  };
  return createRegisteredChildRunInvoker({
    runtime: fixture.runtime,
    telemetryPort: telemetry.noopTelemetry,
    commandRuntime: { kind: 'disabled' },
    agentResolver: {
      resolveByPromptKey: () => ({
        agentDefinition: childDefinition,
        agentConfig: toChildRunAgentConfig(childDefinition),
      }),
    },
    childRunInvoker: createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: fixture.runtime.auditPort,
      llmCaller: fixture.ai.getLlmCaller(),
    }),
  });
}
function request(promptKey = 'research_author_v1') {
  return {
    promptKey,
    userMessage: 'Explain the supplied evidence.',
    parentToolContext: {
      conversationId,
      runId: parentRunId,
      parentToolCallId: ToolCallIdSchema.parse('parent-reasoning-tool'),
      modelId: parentModelId,
      conversationView: { getWorkingHistoryEvents: () => [], getPersistedHistoryEvents: () => [] },
    },
    tracePolicy: { subrunId },
  };
}

describe('durable child reasoning inheritance', () => {
  it.each([false, true])('固定异模型=%s：实际 LLM 请求区分父 low 与模型默认 high', async fixed => {
    const fixture = await open([{ contentChunks: ['Evidence explained.'] }]);
    await seedParent(fixture);
    await expect(invoker(fixture, { fixed }).invoke(request())).resolves.toMatchObject({
      success: true,
    });
    const descriptor = await fixture.runtime.runDescriptors?.load(childRunId);
    expect(descriptor?.request.reasoning_effort).toBe(fixed ? undefined : 'low');
    expect(fixture.ai.getCalls()).toHaveLength(1);
    expect(fixture.ai.getCalls()[0]).toMatchObject({
      modelId: fixed ? fixedModelId : parentModelId,
      options: { reasoning_effort: fixed ? 'high' : 'low' },
    });
    fixture.ai.assertAllTurnsConsumed();
  });

  it('真实 child 推理中断、SQLite 重开后仍用原 low，调用方的新父偏好不改旧请求', async () => {
    const first = await open([{ throwAfterEvents: new Error('Synthetic inference interruption') }]);
    await seedParent(first);
    await expect(invoker(first).invoke(request())).rejects.toMatchObject({
      code: 'RUN_RECOVERY_BLOCKED',
    });
    expect(fixtureEffort(first)).toBe('low');
    expect(await first.runtime.runDescriptors?.hasCommittedCheckpoint(childRunId)).toBe(true);
    expect(await first.runtime.supervisor.peek(childRunId)).toMatchObject({ status: 'paused' });
    await new Promise(resolve => setTimeout(resolve, 0));
    first.close();
    closers.pop();
    resetAgentRuntimeSingletonsForTest();

    const resumed = await open([{ contentChunks: ['Recovered with the original preference.'] }]);
    const descriptors = resumed.runtime.runDescriptors;
    if (!descriptors) throw new Error('Missing durable descriptors');
    const load = descriptors.load.bind(descriptors);
    // 原 descriptor 在生产中不可改写；在接纳读边界提供不同父偏好，验证 child 冻结输入优先。
    vi.spyOn(descriptors, 'load').mockImplementation(async runId => {
      const descriptor = await load(runId);
      return descriptor && runId === parentRunId
        ? { ...descriptor, request: { ...descriptor.request, reasoning_effort: 'high' } }
        : descriptor;
    });
    await expect(invoker(resumed).invoke(request())).resolves.toMatchObject({ success: true });
    expect(fixtureEffort(resumed)).toBe('low');
    expect((await descriptors.load(childRunId))?.request.reasoning_effort).toBe('low');
    expect((await resumed.runtime.supervisor.list({ parentRunId })).runs).toHaveLength(1);
    resumed.ai.assertAllTurnsConsumed();
  });
});

function fixtureEffort(fixture: Fixture) {
  expect(fixture.ai.getCalls()).toHaveLength(1);
  return fixture.ai.getCalls()[0]?.options.reasoning_effort;
}

describe('durable child request admission', () => {
  // 这里只用正式研究定义检验接纳与冻结，不注册新的公开研究子类型，也不冒充完整文章链。
  it('有项目的研究 child 首次接纳 scope，再把同一范围交给实际 LLM', async () => {
    const fixture = await open([{ contentChunks: ['Controlled research result.'] }]);
    const projectId = createProjectLifecycle(fixture.db).create({ name: 'Synthetic child inputs' });
    await seedParent(fixture, projectId);
    await expect(invoker(fixture, { promptKey: 'research_v1' }).invoke(request('research_v1')))
      .resolves.toMatchObject({ success: true });

    const descriptor = await fixture.runtime.runDescriptors?.load(childRunId);
    expect(descriptor?.request).toMatchObject({
      project_metadata: { id: projectId },
      researchScope: {
        question: 'Explain the supplied evidence.',
        task_type: 'open',
        materials: [],
      },
    });
    const system = fixture.ai.getCalls()[0]?.messages.find(message => message.role === 'system');
    expect(system?.content).toEqual(expect.stringContaining('"task_type": "open"'));
    expect(system?.content).toEqual(expect.stringContaining('Explain the supplied evidence.'));
    fixture.ai.assertAllTurnsConsumed();
  });

  it('缺项目的研究 child 在启动和付费推理之前明确拒绝', async () => {
    const fixture = await open([]);
    await seedParent(fixture);
    const outcome = invoker(fixture, { promptKey: 'research_v1' }).invoke(request('research_v1'));
    await expect(outcome).rejects.toMatchObject({
      code: 'CHILD_REQUEST_ADMISSION_REJECTED',
      cause: expect.objectContaining({ code: 'RESEARCH_PROJECT_REQUIRED' }),
    });
    await expect(outcome).rejects.not.toBeInstanceOf(graph.RunRecoveryBlockedError);
    expect(await fixture.runtime.supervisor.peek(childRunId)).toBeFalsy();
    expect(await fixture.runtime.runDescriptors?.load(childRunId)).toBeNull();
    expect(fixture.ai.getCalls()).toHaveLength(0);
  });

  it('缺少持久父输入时，不允许跳过角色接纳降级启动 child', async () => {
    const fixture = await open([]);
    await expect(invoker(fixture, { promptKey: 'research_v1' }).invoke(request('research_v1')))
      .rejects.toThrow('Child request admission requires durable parent inputs');
    expect(await fixture.runtime.supervisor.peek(childRunId)).toBeFalsy();
    expect(fixture.ai.getCalls()).toHaveLength(0);
  });

  it('研究 child 中断并重开 SQLite：保留原范围、不重新接纳；完成后重取结果不再次推理', async () => {
    const definition = findRegisteredAgentDefinitionByPromptKey('research_v1');
    const admit = definition?.requestAdmission;
    if (!admit) throw new Error('Missing research admission');
    const admission = vi.fn(admit);
    const first = await open([{ throwAfterEvents: new Error('Synthetic research interruption') }]);
    const projectId = createProjectLifecycle(first.db).create({ name: 'Synthetic child inputs' });
    await seedParent(first, projectId);
    await expect(invoker(first, { promptKey: 'research_v1', requestAdmission: admission })
      .invoke(request('research_v1'))).rejects.toMatchObject({ code: 'RUN_RECOVERY_BLOCKED' });
    expect(admission).toHaveBeenCalledTimes(1);
    const original = await first.runtime.runDescriptors?.load(childRunId);
    expect(original?.request.researchScope?.task_type).toBe('open');
    expect(await first.runtime.supervisor.peek(childRunId)).toMatchObject({ status: 'paused' });
    await new Promise(resolve => setTimeout(resolve, 0));
    first.close();
    closers.pop();
    resetAgentRuntimeSingletonsForTest();

    const resumed = await open([{ contentChunks: ['Recovered controlled research result.'] }]);
    // 配置内容不变，只让首次接纳函数拒绝，证明恢复不偷偷重走该入口。
    const noReadmission = vi.fn((): never => { throw new Error('Unexpected readmission'); });
    const invoke = invoker(resumed, { promptKey: 'research_v1', requestAdmission: noReadmission });
    await expect(invoke.invoke(request('research_v1'))).resolves.toMatchObject({ success: true });
    expect(noReadmission).not.toHaveBeenCalled();
    expect((await resumed.runtime.runDescriptors?.load(childRunId))?.request).toEqual(original?.request);
    expect(resumed.ai.getCalls()).toHaveLength(1);
    await expect(invoke.invoke(request('research_v1'))).resolves.toMatchObject({ success: true });
    expect(resumed.ai.getCalls()).toHaveLength(1);
    expect((await resumed.runtime.supervisor.list({ parentRunId })).runs).toHaveLength(1);
    resumed.ai.assertAllTurnsConsumed();
  });
});
