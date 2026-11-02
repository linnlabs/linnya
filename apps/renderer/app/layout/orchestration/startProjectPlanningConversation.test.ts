import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_PLANNING_AGENT_CHOICE_ID,
  startProjectPlanningConversation,
  type StartProjectPlanningConversationInput,
} from './startProjectPlanningConversation';

function createInput(description: string) {
  const calls: string[] = [];
  const send = vi.fn(async () => {
    calls.push('send');
    return true;
  });
  const chooseAgent = vi.fn(async () => {
    calls.push('chooseAgent');
  });
  const input: StartProjectPlanningConversationInput = {
    project: { id: 'project-1', name: 'Demo', description },
    navigation: {
      openWorkspace: vi.fn(async () => {
        calls.push('openWorkspace');
      }),
    },
    startDraft: vi.fn(() => {
      calls.push('startDraft');
    }),
    chooseAgent,
    send,
    resolveInitialMessage: (key, params) => `${key}:${JSON.stringify(params)}`,
  };
  return { input, calls, send, chooseAgent };
}

describe('startProjectPlanningConversation', () => {
  it('binds the agent to a fresh project conversation before the first message', async () => {
    const { input, calls, chooseAgent } = createInput('');

    await expect(startProjectPlanningConversation(input)).resolves.toBe(true);

    expect(calls).toEqual(['openWorkspace', 'startDraft', 'chooseAgent', 'send']);
    expect(chooseAgent).toHaveBeenCalledWith(PROJECT_PLANNING_AGENT_CHOICE_ID);
    expect(input.startDraft).toHaveBeenCalledWith({ kind: 'project', projectId: 'project-1' });
  });

  it('sends a short visible message and passes project metadata', async () => {
    const { input, send } = createInput('  Reduce churn  ');

    await startProjectPlanningConversation(input);

    expect(send).toHaveBeenCalledWith(
      'layout.projectPlanning.initialMessageWithDescription:{"projectName":"Demo","projectDescription":"Reduce churn"}',
      { id: 'project-1', name: 'Demo', description: 'Reduce churn' },
    );
  });

  it('omits the description clause when the project has none', async () => {
    const { input, send } = createInput('   ');

    await startProjectPlanningConversation(input);

    expect(send.mock.calls[0]?.[0]).toBe('layout.projectPlanning.initialMessage:{"projectName":"Demo"}');
  });

  it('does not send when the agent cannot be persisted', async () => {
    const { input, send, chooseAgent } = createInput('');
    chooseAgent.mockRejectedValueOnce(new Error('persist failed'));

    await expect(startProjectPlanningConversation(input)).rejects.toThrow('persist failed');

    expect(send).not.toHaveBeenCalled();
  });
});
