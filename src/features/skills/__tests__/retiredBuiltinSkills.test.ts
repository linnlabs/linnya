import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentInvokeRequestSchema } from '../../../app-hosts/linnya/context/agent/schemas';
import { GenericAgentTask } from '../../../app-hosts/linnya/agent-registry/GenericAgentTask';
import defaultAgent from '../../../app-hosts/linnya/agent-registry/agents/default';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { PromptKeys } from '@app/schemas';
import { SkillTool } from '../../../tools/skill/SkillTool';
import { getAllSkillMetadata, loadSkillContent } from '../catalog';
import { invalidateSkillCache } from '../discovery';

describe('retired builtin skills', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
    invalidateSkillCache();
  });

  it('mckinsey-research 不再进入内置目录或 Agent 的 Skill 目录', () => {
    const names = getAllSkillMetadata().map(skill => skill.name);
    expect(names).toContain('deep-research');
    expect(names).not.toContain('mckinsey-research');

    const prompt = new GenericAgentTask(defaultAgent).getSystemPromptForRequest(
      AgentInvokeRequestSchema.parse({ query: 'test', promptKey: PromptKeys.DEFAULT })
    );
    expect(prompt).toContain('name="deep-research"');
    expect(prompt).not.toContain('mckinsey-research');
  });

  it('点名已退役的 mckinsey-research 时说明已退役并指向 deep-research 的商业分析资源', async () => {
    expect(() => loadSkillContent('mckinsey-research')).toThrow(
      /找不到 Skill "mckinsey-research"：该内置 Skill 已退役.*references\/business-analysis\.md.*可用：/
    );
    await expect(
      new SkillTool().run({ action: 'activate', skill_name: 'mckinsey-research' }, {})
    ).rejects.toThrow(/已退役/);
    expect(loadSkillContent('deep-research').resources).toContain(
      'references/business-analysis.md'
    );
  });

  it('其它找不到的 Skill 保持原有提示，不附退役说明', () => {
    expect(() => loadSkillContent('no-such-skill')).toThrow(/找不到 Skill "no-such-skill"。可用：/);
    expect(() => loadSkillContent('no-such-skill')).not.toThrow(/已退役/);
  });
});
