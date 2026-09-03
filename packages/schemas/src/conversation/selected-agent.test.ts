import { describe, expect, it } from 'vitest';
import {
  ConversationSelectedAgentIdSchema,
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
});
