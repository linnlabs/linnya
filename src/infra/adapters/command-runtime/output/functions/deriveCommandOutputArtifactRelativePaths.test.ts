import { describe, expect, it } from 'vitest';

import { CommandOutputArtifactOwnerSchema } from '../../../../../domains/commands/definitions/commandOutputArtifact';
import { deriveCommandOutputArtifactRelativePaths } from './deriveCommandOutputArtifactRelativePaths';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';

function createOwner(conversationId: string) {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: conversationId,
      agent_run_id: 'run-a',
      origin_tool_call_id: 'shell-call-a',
      command_execution_id: EXECUTION_ID,
      owner_generation_id: OWNER_GENERATION_ID,
      created_at_ms: 1_785_499_200_000,
    },
    instance_id: 'instance'.repeat(30),
  });
}

describe('Command output artifact storage identity', () => {
  it('对普通清理会碰撞的身份仍保持隔离，并按模式固定文件集合', () => {
    const slash = deriveCommandOutputArtifactRelativePaths(createOwner('conversation/a'), 'pipe');
    const question = deriveCommandOutputArtifactRelativePaths(createOwner('conversation?a'), 'pty');

    expect(slash.directorySegments[0]).not.toBe(question.directorySegments[0]);
    expect(slash.directorySegments.join('/')).not.toContain('conversation/a');
    expect(slash.streamFileNames).toEqual(['stdout.bin', 'stderr.bin']);
    expect(question.streamFileNames).toEqual(['terminal.bin']);
  });
});
