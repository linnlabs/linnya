import { describe, expect, it } from 'vitest';
import { PromptKeys, ConversationControlSendRequestSchema } from '@app/schemas';
import { legacyBuiltinAgentDefinitions } from '../legacyAgentDefinitions';
import { AGENT_DEFINITION } from './index';
import defaultAgent from '../default';
import { parseCliInvocation } from '../../../../../../apps/linnya-cli/src/functions/parseCliInvocation';

describe('internal judge registry admission', () => {
  it('is CLI-addressable via the standard string agent contract with a dedicated tool whitelist', () => {
    expect(parseCliInvocation(['send', 'Review article', '--project', 'project-1', '--agent', PromptKeys.INTERNAL_JUDGE])).toMatchObject({
      kind: 'command', request: { selected_agent_id: PromptKeys.INTERNAL_JUDGE, project_id: 'project-1' },
    });
    const request = ConversationControlSendRequestSchema.parse({
      schema_version: 1, command: 'send', message: 'Review workspace:/article.md into workspace:/review.md',
      project_id: 'project-1', selected_agent_id: PromptKeys.INTERNAL_JUDGE,
    });
    expect(legacyBuiltinAgentDefinitions.find(agent => agent.id === request.selected_agent_id)).toBe(AGENT_DEFINITION);
    expect(AGENT_DEFINITION.config?.availableTools).toContain('judge_record');
    expect(defaultAgent.config?.availableTools).not.toContain('judge_record');
    expect(AGENT_DEFINITION.config?.availableTools).not.toContain('web_search');
  });
});
