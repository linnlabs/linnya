import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ResearchRunArgsSchema,
  SkillActivateResultSchema,
  SkillReadResourceResultSchema,
} from '@app/schemas';
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
import { getBuiltinSkillsRoot } from 'src/features/skills/builtin';
import { invalidateSkillCache } from 'src/features/skills/discovery';
import { loadSkillContent } from 'src/features/skills/catalog';
import {
  validatePluginAgentRequiredSkills,
  validateSkillExposureConfig,
} from 'src/features/skills/agentSkillExposure';
import { SkillTool } from 'src/tools/skill/SkillTool';
import { SubagentTool } from 'src/tools/agent_control/subrun/subagent/subagentTool';

const ROLES = [
  'research_author_v1',
  'research_investigation_review_v1',
  'research_argument_review_v1',
  'research_source_review_v1',
] as const;

describe('main research and prompt-based document roles through formal preparation and Skill access', () => {
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

  it('prepares a normal main conversation with the original request and freezes its admitted document scope', async () => {
    const query = '只使用提供的材料向项目负责人解释变化，保留不确定性；正文不超过一千字。';
    const scope = ResearchRunArgsSchema.parse({
      question: '样本运输成本的变化',
      reader: '项目负责人',
      task_type: 'fixed',
      materials: ['workspace:/inputs/transport.md'],
      time_range: '2024—2025',
    });
    const admitted = resolveAgentRequestAdmission(
      {
        promptKey: 'research_v1',
        query,
        project_metadata: { id: 'research-project' },
        researchScope: scope,
      },
      { history: [] }
    );
    // 新入口进入普通模型循环；接纳范围不能把整个请求改成隐藏的 Host 工具调用。
    expect(resolveAgentHostEntry(admitted)).toBeUndefined();
    expect(admitted.query).toBe(query);
    expect(admitted.researchScope).toEqual(scope);
    const frozen = freezeAgentRunInput(admitted);
    const subagent = new SubagentTool();
    const context = { callerAgentId: frozen.callerAgentId };
    const choices = subagent.getParametersForContext().properties.subagent_type.enum;
    // 职责由任务明确，通用委派不按父角色隐藏其他已注册类型。
    expect(choices).toEqual(
      expect.arrayContaining([
        'general',
        'document_editor',
        'research_investigation',
        'research_investigation_review',
        'research_argument_review',
        'research_source_review',
      ])
    );
    for (const type of ['research_draft', 'research_revision']) {
      await expect(
        subagent.run(
          {
            description: '委派成文',
            prompt: '请替父 Agent 完成文章',
            subagent_type: type,
          },
          context
        )
      ).rejects.toThrow(`unknown subagent_type "${type}"`);
    }
    const task = getAgentTask('research_v1');
    if (!(task instanceof GenericAgentTask))
      throw new Error('Main research must use the registered task');
    const messages = task.buildMessages(frozen, []);
    expect(messages.some(message => message.role === 'user' && message.content === query)).toBe(
      true
    );
    const system = messages.find(
      message => message.role === 'system' && message.type === 'system_prompt'
    );
    expect(system?.content).toContain(JSON.stringify(scope, null, 2));
    expect(system?.content).toContain('<skill name="deep-research">');
    const resumed: AgentInvokeRequest = {
      ...frozen,
      researchScope: ResearchRunArgsSchema.parse({
        ...scope,
        reader: 'a changed reader',
        materials: ['workspace:/other.md'],
      }),
    };
    expect(task.getSystemPromptForRequest(resumed)).toBe(frozen.frozenSystemPrompt);
  });

  it.each(ROLES)(
    '%s: delivers the caller request without a hidden stage handoff and freezes the role prompt',
    promptKey => {
      const query =
        'Review target: workspace:/draft.md\nChecking materials: workspace:/source.md\nNo external retrieval. Output: workspace:/review.md';
      const resolved = createDefaultRegisteredAgentResolver().resolveByPromptKey(promptKey);
      validateSkillExposureConfig([resolved.agentDefinition]);
      validatePluginAgentRequiredSkills({
        pluginId: 'platform',
        definitions: [resolved.agentDefinition],
        skillSourceRoots: [],
      });
      const admitted = freezeAgentRunInput({ query, promptKey });
      const task = getAgentTask(promptKey);
      if (!(task instanceof GenericAgentTask))
        throw new Error('Research role must use GenericAgentTask');
      const messages = task.buildMessages(admitted, []);
      const system = messages.find(
        message => message.role === 'system' && message.type === 'system_prompt'
      );
      expect(system?.content).toContain(admitted.frozenSystemPrompt);
      expect(system?.content).toContain('<skill name="deep-research">');
      expect(messages.some(message => message.role === 'user' && message.content === query)).toBe(
        true
      );
      const injected: string[] = [];
      systemReminder.applySystemReminders({
        llmMessages: [{ role: 'user', content: query }],
        ctx: {
          request: admitted,
          history: [],
          executorLocal: { stepCount: 30, maxSteps: 800, remainingSteps: 770 },
        },
        policy: resolved.agentConfig.systemReminderPolicy,
        onInjected: info => injected.push(...info.ruleIds),
      });
      expect(injected).toEqual([]);
      expect(task.getSystemPromptForRequest({ ...admitted, query: 'resume' })).toBe(
        admitted.frozenSystemPrompt
      );
    }
  );

  it('discovers the writing index and nested genre cards and delivers resources on demand through the real Skill tool', async () => {
    const skill = new SkillTool();
    const activation = SkillActivateResultSchema.parse(
      JSON.parse(
        await skill.run(
          {
            action: 'activate',
            skill_name: 'deep-research',
          },
          {}
        )
      )
    );
    const content = loadSkillContent('deep-research');
    expect(activation.data).toMatchObject({
      activated: true,
      source: 'builtin',
      resource_count: content.resources.length,
    });
    expect(activation.observation).toContain(content.body);
    const root = path.join(getBuiltinSkillsRoot(), 'deep-research');
    // 校验从入口到深层文体卡的真实发现/读取链，不将写作措辞的旧hash当成业务合同。
    expect(content.resources).toEqual(
      expect.arrayContaining([
        'references/article-craft.md',
        'references/writing/index.md',
        'references/writing/genres/explainer.md',
      ])
    );
    for (const file of content.resources) {
      const text = readFileSync(path.join(root, file), 'utf8');
      const result = SkillReadResourceResultSchema.parse(
        JSON.parse(
          await skill.run(
            {
              action: 'read_resource',
              skill_name: 'deep-research',
              resource_path: file,
            },
            {}
          )
        )
      );
      expect(result.data.is_truncated).toBe(false);
      expect(result.data.start_line).toBe(1);
      expect(result.data.end_line).toBe(result.data.total_lines);
      expect(result.observation).toContain(text.trimEnd());
    }
  });
});
