import { buildPrompt } from '../../prompt.builder';
import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition } from '../../types';
import { SYSTEM_BATCH_SUMMARIZER_PROMPT } from './prompt';

function buildSystemPrompt(): string {
  return buildPrompt(SYSTEM_BATCH_SUMMARIZER_PROMPT, {
    language_instruction: '请使用中文回答，除非用户明确要求使用其他语言。',
  });
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
  promptKey: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
  defaultMode: 'agent',
  description: '系统发起 batch 的收尾 Agent（无工具，仅总结）',
  config: {
    contextPolicy: { profileId: 'agent' },
    // 系统 batch 已完成全部动作；收尾阶段物理禁用工具，避免父 Agent 重复执行副作用。
    enableTools: false,
    availableTools: [],
    modelPolicy: { kind: 'user_primary' },
  },
  task: {
    systemPromptBuilder: buildSystemPrompt,
  },
};

export default AGENT_DEFINITION;
