import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema, SkillActivateResultSchema, SkillReadResourceResultSchema } from '@app/schemas';
import { systemReminder } from '@linnlabs/linnkit/runtime-kernel';
import { freezeAgentRunInput } from '../../freezeAgentRunInput';
import { GenericAgentTask } from '../../GenericAgentTask';
import { clearRegisteredAgentTaskCache, getAgentTask } from '../../agentTaskResolver';
import { resolveAgentHostEntry } from '../../resolveAgentHostEntry';
import { resolveAgentRequestAdmission } from '../../resolveAgentRequestAdmission';
import { createDefaultRegisteredAgentResolver } from '../../../adapters/child-runs/registeredAgentResolver';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { buildResearchStageRequest } from '../../../application/research/functions/buildResearchStageRequest';
import type {
  ResearchStageRequestInput,
  ResearchStageRequestKind,
} from '../../../application/research/definitions/researchStageRequest';
import { getBuiltinSkillsRoot } from 'src/features/skills/builtin';
import { invalidateSkillCache } from 'src/features/skills/discovery';
import { loadSkillContent } from 'src/features/skills/catalog';
import {
  validatePluginAgentRequiredSkills,
  validateSkillExposureConfig,
} from 'src/features/skills/agentSkillExposure';
import { SkillTool } from 'src/tools/skill/SkillTool';

function request(stage: ResearchStageRequestKind): ResearchStageRequestInput {
  return {
    stage,
    question: '为什么样本地区的平均运输成本下降？',
    reader: '需要理解数量与机制的一般读者',
    taskType: 'fixed',
    allowRetrieval: false,
    materialBoundary: '仅使用指定的合成运量与成本材料，不能补外部事实',
    timeRange: '2024—2025',
    fixedDocumentLocators: ['workspace:/inputs/transport.md'],
    previousArtifacts: [{ locator: 'workspace:/research/investigation.md', version: 'investigation-1', purpose: '当前解释与来源目录' }],
    unresolvedQuestions: ['运量变化还是单位价格变化足以解释差异？'],
    feedback: ['核对原稿是否把样本结果扩大为全部地区。'],
    output: { locator: `workspace:/research/${stage}.md`, purpose: '当前阶段唯一交付' },
    businessAnalysisNeeded: false,
  };
}

const STAGES: readonly ResearchStageRequestKind[] = [
  'investigation', 'investigation_review', 'draft', 'argument_review', 'source_review', 'revision',
];

describe('main research and controlled document roles through formal preparation and Skill access', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    invalidateSkillCache();
    clearRegisteredAgentTaskCache();
  });

  afterEach(() => {
    clearRegisteredAgentTaskCache();
    clearPluginRuntimeStateForTests();
    invalidateSkillCache();
  });

  it('prepares a normal main conversation with the original request and freezes its admitted document scope', () => {
    const query = '只使用提供的材料向项目负责人解释变化，保留不确定性；正文不超过一千字。';
    const scope = ResearchRunArgsSchema.parse({
      question: '样本运输成本的变化', reader: '项目负责人', task_type: 'fixed',
      materials: ['workspace:/inputs/transport.md'], time_range: '2024—2025',
    });
    const admitted = resolveAgentRequestAdmission({
      promptKey: 'research_v1', query, project_metadata: { id: 'research-project' }, researchScope: scope,
    }, { history: [] });
    // 新入口进入普通模型循环；接纳范围不能把整个请求改成隐藏的 Host 工具调用。
    expect(resolveAgentHostEntry(admitted)).toBeUndefined();
    expect(admitted.query).toBe(query);
    expect(admitted.researchScope).toEqual(scope);
    const frozen = freezeAgentRunInput(admitted);
    const task = getAgentTask('research_v1');
    if (!(task instanceof GenericAgentTask)) throw new Error('Main research must use the registered task');
    const messages = task.buildMessages(frozen, []);
    expect(messages.some(message => message.role === 'user' && message.content === query)).toBe(true);
    const system = messages.find(message => message.role === 'system' && message.type === 'system_prompt');
    expect(system?.content).toContain(JSON.stringify(scope, null, 2));
    expect(system?.content).toContain('<skill name="deep-research">');
    const resumed: AgentInvokeRequest = {
      ...frozen,
      researchScope: ResearchRunArgsSchema.parse({
        ...scope, reader: 'a changed reader', materials: ['workspace:/other.md'],
      }),
    };
    expect(task.getSystemPromptForRequest(resumed)).toBe(frozen.frozenSystemPrompt);
  });

  it.each(STAGES)('%s: preserves the full stage request, frozen system and restricted child config', stage => {
    const input = request(stage);
    const prepared = buildResearchStageRequest(input);
    const resolved = createDefaultRegisteredAgentResolver().resolveByPromptKey(prepared.promptKey);
    validateSkillExposureConfig([resolved.agentDefinition]);
    validatePluginAgentRequiredSkills({
      pluginId: 'platform', definitions: [resolved.agentDefinition], skillSourceRoots: [],
    });
    const admitted = freezeAgentRunInput({ query: prepared.query, promptKey: prepared.promptKey });
    const task = getAgentTask(prepared.promptKey);
    if (!(task instanceof GenericAgentTask)) throw new Error('Research role must use GenericAgentTask');
    const messages = task.buildMessages(admitted, []);
    const system = messages.find(message => message.role === 'system' && message.type === 'system_prompt');
    // Linnkit 当前每次 buildMessages 都追加安全尾注；这里只核冻结产品内容完整送达。
    expect(system?.content).toContain(admitted.frozenSystemPrompt);
    expect(system?.content).toContain('<skill name="deep-research">');
    expect(system?.content).not.toContain('Use TaskState');
    expect(system?.content).not.toContain('<long_running_work>');
    expect(messages.some(message => message.role === 'user' && message.content === prepared.query)).toBe(true);
    for (const value of [input.question, input.reader, input.materialBoundary, input.timeRange,
      input.output.locator, ...input.fixedDocumentLocators, ...input.unresolvedQuestions, ...input.feedback]) {
      expect(prepared.query).toContain(value);
    }
    expect(prepared.query).toContain('investigation-1');
    expect(prepared.query).toContain('No external retrieval is allowed');
    expect(prepared.query).toContain('Host saves it create-only');
    expect(prepared.query).toContain('Finish by calling submit_research_document');
    expect(system?.content).toContain('A free-text final answer is not a saved deliverable');
    expect(prepared.requiredResources).not.toContain('references/business-analysis.md');
    for (const resource of prepared.requiredResources) expect(prepared.query).toContain(resource);

    const tools = resolved.agentConfig.availableTools ?? [];
    expect(tools).toEqual(expect.arrayContaining(['read_file', 'web_search', 'skill', 'shell', 'process', 'submit_research_document']));
    for (const forbidden of ['write_file', 'edit_file', 'subagent', 'task_write', 'task_read', 'write_report']) {
      expect(tools).not.toContain(forbidden);
    }
    expect(resolved.agentDefinition.config?.maxSteps).toBe(800);
    expect(resolved.agentDefinition.config?.modelPolicy).toEqual({ kind: 'inherit_parent' });
    // 周期提醒在实际准备链不应偷偷恢复 Default 的任务编排指令。
    const injected: string[] = [];
    systemReminder.applySystemReminders({
      llmMessages: [{ role: 'user', content: prepared.query }],
      ctx: {
        request: admitted, history: [],
        executorLocal: { stepCount: 30, maxSteps: 800, remainingSteps: 770 },
      },
      policy: resolved.agentConfig.systemReminderPolicy,
      onInjected: info => injected.push(...info.ruleIds),
    });
    expect(injected).toEqual([]);
    expect(task.getSystemPromptForRequest({ ...admitted, query: 'resume' })).toBe(admitted.frozenSystemPrompt);
  });

  it('distinguishes pre-draft investigation review from article review and supplies revision evidence discipline once', () => {
    const investigation = buildResearchStageRequest(request('investigation_review'));
    expect(investigation.query).toContain('a finished article is not required');
    expect(investigation.requiredResources).toEqual(['references/modeling.md']);
    const argument = buildResearchStageRequest(request('argument_review'));
    expect(argument.requiredResources).toContain('references/article-craft.md');
    const revision = buildResearchStageRequest({ ...request('revision'), businessAnalysisNeeded: true });
    expect(revision.requiredResources).toContain('references/business-analysis.md');
    expect(revision.query.match(/Feedback method research-feedback-v1/g)).toHaveLength(1);
    expect(revision.query).toContain('Accept, narrow or reject');
    expect(revision.query).toContain('title, opening and conclusion');
  });

  it('delivers the unchanged formal 1.4 body and full applicable resources through the real Skill tool', async () => {
    const skill = new SkillTool();
    const activation = SkillActivateResultSchema.parse(JSON.parse(await skill.run({
      action: 'activate', skill_name: 'deep-research',
    }, {})));
    const content = loadSkillContent('deep-research');
    expect(activation.data).toMatchObject({ activated: true, source: 'builtin', resource_count: 3 });
    expect(activation.observation).toContain(content.body);
    const root = path.join(getBuiltinSkillsRoot(), 'deep-research');
    const files = [
      ['SKILL.md', '8c9372a32454ecda1906387a586c525626788a5d01091c135cd6db6572308f42'],
      ['references/modeling.md', '9c462aec2caa5d97f897cbf178f7221e9404bfea07ed80638f1cd7c521bd6ff7'],
      ['references/article-craft.md', '01f2605e1f554de06b0654cecbc27e22563898530def43a680789dcff6b2b9e9'],
      ['references/business-analysis.md', 'b90c399cd2edc7015b64b2bd0d95ce9cbc0b299fd951cfc0c3afd28e3c8f1af1'],
    ] as const;
    for (const [file, expectedHash] of files) {
      const text = readFileSync(path.join(root, file), 'utf8');
      expect(createHash('sha256').update(text).digest('hex')).toBe(expectedHash);
      if (file === 'SKILL.md') continue;
      const result = SkillReadResourceResultSchema.parse(JSON.parse(await skill.run({
        action: 'read_resource', skill_name: 'deep-research', resource_path: file,
      }, {})));
      expect(result.data.is_truncated).toBe(false);
      expect(result.data.start_line).toBe(1);
      expect(result.data.end_line).toBe(result.data.total_lines);
      expect(result.observation).toContain(text.trimEnd());
    }
  });
});
