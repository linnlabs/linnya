import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../contracts';
import { buildToolInteractionGroupsFromMessages } from '../toolInteractionGroup';
import { ToolCallIdSchema } from '../../../contracts';

function userInput(id: string, timestamp: number): AiMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: id,
    timestamp,
  };
}

function toolGroup(id: string, timestamp: number): AiMessage[] {
  const toolCallId = `tc_${id}`;
  return [
    {
      id: `a_${id}`,
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp,
      metadata: {
        tool_calls: [
          {
            id: ToolCallIdSchema.parse(toolCallId),
            type: 'function',
            function: {
              name: 'workspace_read',
              arguments: '{}',
            },
          },
        ],
      },
    },
    {
      id: `t_${id}`,
      role: 'tool',
      type: 'tool_output',
      content: id,
      timestamp: timestamp + 1,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        tool_name: 'workspace_read',
        data: { value: id },
      },
    },
  ];
}

describe('ToolInteractionGroup runOrdinal', () => {
  it('assigns runOrdinal 0 to tool groups before any user_input', () => {
    const groups = buildToolInteractionGroupsFromMessages([...toolGroup('before_user', 1)]);

    expect(groups.map(group => group.runOrdinal)).toEqual([0]);
  });

  it('increments runOrdinal by user_input boundaries and keeps the current run as max ordinal', () => {
    const groups = buildToolInteractionGroupsFromMessages([
      ...toolGroup('before_user', 1),
      userInput('u_1', 10),
      ...toolGroup('run_1_a', 11),
      ...toolGroup('run_1_b', 12),
      userInput('u_2', 20),
      ...toolGroup('run_2', 21),
    ]);

    expect(groups.map(group => [group.anchorId, group.runOrdinal])).toEqual([
      ['a_before_user', 0],
      ['a_run_1_a', 1],
      ['a_run_1_b', 1],
      ['a_run_2', 2],
    ]);
    expect(Math.max(...groups.map(group => group.runOrdinal))).toBe(
      groups[groups.length - 1]?.runOrdinal
    );
  });
});
