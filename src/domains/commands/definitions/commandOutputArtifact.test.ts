import { describe, expect, it } from 'vitest';

import {
  CommandOutputArtifactOwnerSchema,
  parseCommandOutputArtifactManifest,
} from './commandOutputArtifact';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const SHA256 = 'a'.repeat(64);

function createOwner(conversationId = 'conversation-a', instanceId = 'default') {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: conversationId,
      agent_run_id: 'run-a',
      origin_tool_call_id: 'shell-call-a',
      command_execution_id: EXECUTION_ID,
      owner_generation_id: OWNER_GENERATION_ID,
      created_at_ms: 1_785_499_200_000,
    },
    instance_id: instanceId,
  });
}

function createCompleteStream() {
  return {
    status: 'complete',
    source_completion: 'complete',
    observed_bytes: 12,
    persisted_bytes: 12,
    last_persisted_offset: 12,
    sha256: SHA256,
  };
}

function createManifest() {
  return {
    version: 1,
    owner: createOwner(),
    mode: 'pipe',
    sealed_at_ms: 1_785_499_201_000,
    retention_until_ms: 1_786_104_001_000,
    stdout: createCompleteStream(),
    stderr: createCompleteStream(),
  };
}

describe('Command output artifact contract', () => {
  it('普通 pipe 保留 stdout/stderr 双流，PTY 只能保留 terminal byte 流', () => {
    expect(parseCommandOutputArtifactManifest(createManifest()).mode).toBe('pipe');

    expect(() => parseCommandOutputArtifactManifest({
      ...createManifest(),
      mode: 'pty',
      terminal: createCompleteStream(),
    })).toThrow();

    expect(parseCommandOutputArtifactManifest({
      version: 1,
      owner: createOwner(),
      mode: 'pty',
      sealed_at_ms: 1_785_499_201_000,
      retention_until_ms: 1_786_104_001_000,
      terminal: createCompleteStream(),
    }).mode).toBe('pty');
  });

  it('不能把缺失 byte 的流标记为完整', () => {
    expect(() => parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: {
        ...createCompleteStream(),
        observed_bytes: 13,
      },
    })).toThrow('complete command output must persist every observed byte');
  });

  it('不完整流保留首个错误和最后成功位置，且不能伪造已写入规模', () => {
    const incomplete = {
      status: 'incomplete',
      source_completion: 'complete',
      observed_bytes: 20,
      persisted_bytes: 12,
      last_persisted_offset: 12,
      first_error: {
        code: 'storage_full',
        stage: 'append',
        occurred_at_ms: 1_785_499_200_500,
        last_persisted_offset: 12,
      },
    };

    const manifest = parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: incomplete,
    });
    expect(manifest.mode === 'pipe' && manifest.stdout.status).toBe('incomplete');

    expect(() => parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: {
        ...incomplete,
        persisted_bytes: 21,
        last_persisted_offset: 21,
        first_error: {
          ...incomplete.first_error,
          last_persisted_offset: 21,
        },
      },
    })).toThrow('persisted command output bytes cannot exceed observed bytes');
  });

  it('来源中断与存储失败分别记录，不能把已经收到的部分伪装成全文', () => {
    const sourceInterrupted = parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: {
        status: 'incomplete',
        source_completion: 'interrupted',
        observed_bytes: 12,
        persisted_bytes: 12,
        last_persisted_offset: 12,
        sha256: SHA256,
      },
    });
    expect(sourceInterrupted.mode === 'pipe' && sourceInterrupted.stdout).toMatchObject({
      status: 'incomplete',
      source_completion: 'interrupted',
    });
    expect(() => parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: {
        status: 'incomplete',
        source_completion: 'interrupted',
        observed_bytes: 13,
        persisted_bytes: 12,
        last_persisted_offset: 12,
        sha256: SHA256,
      },
    })).toThrow('source-interrupted output must persist every observed byte');

    const sourceAndStorageInterrupted = parseCommandOutputArtifactManifest({
      ...createManifest(),
      stdout: {
        status: 'incomplete',
        source_completion: 'interrupted',
        observed_bytes: 20,
        persisted_bytes: 12,
        last_persisted_offset: 12,
        first_error: {
          code: 'storage_full',
          stage: 'append',
          occurred_at_ms: 1_785_499_200_500,
          last_persisted_offset: 12,
        },
      },
    });
    expect(sourceAndStorageInterrupted.mode === 'pipe' && sourceAndStorageInterrupted.stdout)
      .toMatchObject({
        status: 'incomplete',
        source_completion: 'interrupted',
        first_error: { code: 'storage_full' },
      });
  });
});
