import { describe, expect, it } from 'vitest';
import {
  ConversationSelectedAgentIdSchema,
  readConversationSelectedAgentId,
  UpdateConversationSelectedAgentRequestSchema,
} from './selected-agent';

describe('conversation selected agent contract', () => {
  it('admits a product agent identity and supports explicit clear', () => {
    expect(UpdateConversationSelectedAgentRequestSchema.parse({
      selected_agent_id: 'plugin_agent_fixture',
      project_id: null,
    })).toEqual({ selected_agent_id: 'plugin_agent_fixture', project_id: null });
    expect(UpdateConversationSelectedAgentRequestSchema.parse({
      selected_agent_id: null,
      project_id: 'project-1',
    })).toEqual({ selected_agent_id: null, project_id: 'project-1' });
  });

  it('rejects blank identities and hidden control fields', () => {
    expect(() => ConversationSelectedAgentIdSchema.parse('   ')).toThrow();
    expect(() => UpdateConversationSelectedAgentRequestSchema.parse({
      selected_agent_id: 'plugin_agent_fixture',
      project_id: null,
      promptKey: 'plugin_agent_fixture',
    })).toThrow();
  });

  it('reads the default agent id as null and keeps every other identity', () => {
    expect(readConversationSelectedAgentId(null)).toBeNull();
    // 旧数据曾把默认 Agent 的 ID 字面量写进库；读取合同里默认 Agent 只有 null 一种写法。
    expect(readConversationSelectedAgentId('default')).toBeNull();
    expect(readConversationSelectedAgentId(' default ')).toBeNull();
    expect(readConversationSelectedAgentId('research_v1')).toBe('research_v1');
    expect(readConversationSelectedAgentId('scheduled_default')).toBeNull();
    expect(readConversationSelectedAgentId('scheduled_research')).toBe('research_v1');
    // 已不可用的注册表 ID 不在这里判断，展示层按注册表处理。
    expect(readConversationSelectedAgentId('internal_judge')).toBe('internal_judge');
    expect(() => readConversationSelectedAgentId('   ')).toThrow();
  });
});
