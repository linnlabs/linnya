import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationNextRequest } from '@app/schemas/api-dtos';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { findRegisteredAgentDefinitionById } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';
import {
  admitConversationAgentChoice,
  resolveConversationAgentPromptKey,
} from './admitConversationAgentChoice';

vi.mock('src/app-hosts/linnya/agent-registry/agentDefinitionResolver', () => ({
  findRegisteredAgentDefinitionById: vi.fn(),
}));

const slidesAgent = {
  id: 'plugin_agent_fixture',
  promptKey: 'plugin_prompt_fixture',
  defaultMode: 'agent',
  description: 'Slides agent',
} satisfies AgentDefinition;

describe('admitConversationAgentChoice', () => {
  beforeEach(() => {
    vi.mocked(findRegisteredAgentDefinitionById).mockReset();
  });

  it('按 AgentDefinition.id 精确解析，并只向 Host 内部暴露 promptKey', () => {
    vi.mocked(findRegisteredAgentDefinitionById).mockReturnValue(slidesAgent);
    const request = ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      options: { selected_agent_id: 'plugin_agent_fixture' },
    });

    expect(admitConversationAgentChoice(request)).toEqual({
      conversation_id: 'conversation-1',
      options: { promptKey: 'plugin_prompt_fixture' },
    });
    expect(findRegisteredAgentDefinitionById).toHaveBeenCalledWith('plugin_agent_fixture');
  });

  it('wait-user 恢复也能从原 run 的 Agent 身份还原同一 promptKey', () => {
    vi.mocked(findRegisteredAgentDefinitionById).mockReturnValue(slidesAgent);

    expect(resolveConversationAgentPromptKey('plugin_agent_fixture')).toBe('plugin_prompt_fixture');
    expect(findRegisteredAgentDefinitionById).toHaveBeenCalledWith('plugin_agent_fixture');
  });

  it('未知或未启用 Agent 明确失败，不回退 default 或 promptKey alias', () => {
    vi.mocked(findRegisteredAgentDefinitionById).mockReturnValue(undefined);
    const request = ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      options: { selected_agent_id: 'plugin_prompt_fixture' },
    });

    expect(() => admitConversationAgentChoice(request)).toThrow(
      'selected agent is unavailable: plugin_prompt_fixture',
    );
  });
});
