import type { AgentDefinition } from '../../types';
import { RESEARCH_AGENT_ID } from '@app/schemas';
import { admitResearchRequest } from './admission';
import { buildResearchLeaderPrompt } from './leaderPrompt';

/** 研究职责由父子提示承担；运行、委派与文件保存复用通用合同。 */
export default {
  id: RESEARCH_AGENT_ID,
  promptKey: RESEARCH_AGENT_ID,
  defaultMode: 'agent',
  description: '研究：主 Agent 调查、委派独立复核并交付文章',
  requestAdmission: admitResearchRequest,
  config: {
    availableTools: [
      'list_files',
      'read_file',
      'write_file',
      'edit_file',
      'grep',
      'tool_output_read',
      'knowledge_search',
      'knowledge_read',
      'web_search',
      'web_read',
      'skill',
      'shell',
      'process',
      'task_write',
      'task_read',
      'subagent',
    ],
    enableTools: true,
    maxSteps: 800,
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
    skill: { enabled: true, requiredSkills: ['deep-research'] },
    contextPolicy: {
      profileId: 'agent',
      toolHistory: { strategy: 'per-run', retentionMode: 'drop', keepLatestRuns: 2 },
      systemReminder: { enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'] },
    },
    // 预算耗尽时可以如实报告未交付；不能为满足工具收尾而编造修订稿或评审。
    stepPolicy: { kind: 'final_answer', lastStepsHintThreshold: 12 },
  },
  task: {
    systemPromptBuilder: request => {
      if (!request.researchScope)
        throw new Error('Research scope must be admitted before preparing the main Agent');
      return buildResearchLeaderPrompt(request.researchScope);
    },
  },
} satisfies AgentDefinition;
