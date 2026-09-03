import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CommandOutputArtifactManifestSchema,
  CommandOutputArtifactOwnerSchema,
} from '../../../domains/commands/definitions/commandOutputArtifact';
import { deriveCommandOutputArtifactRelativePaths } from '../../../infra/adapters/command-runtime/output';
import { runCommandOutputArtifactStartupMaintenance } from './startupMaintenanceRunner';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

describe('原始命令输出启动编排', () => {
  it('在调用返回前完成已到期 execution 的真实目录清理', async () => {
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-startup-maintenance-'));
    roots.push(storageRoot);
    const owner = CommandOutputArtifactOwnerSchema.parse({
      identity: {
        conversation_id: 'conversation-startup',
        agent_run_id: 'agent-run-startup',
        origin_tool_call_id: 'tool-call-startup',
        command_execution_id: `command_execution_${randomUUID()}`,
        owner_generation_id: `command_owner_${randomUUID()}`,
        created_at_ms: 100,
      },
      instance_id: 'agent-run-startup',
    });
    const relativePaths = deriveCommandOutputArtifactRelativePaths(owner, 'pipe');
    const executionDirectory = path.join(storageRoot, ...relativePaths.directorySegments);
    await fsp.mkdir(executionDirectory, { recursive: true });
    await fsp.writeFile(path.join(executionDirectory, 'stdout.bin'), 'stdout', 'utf8');
    await fsp.writeFile(path.join(executionDirectory, 'stderr.bin'), 'stderr', 'utf8');
    const manifest = CommandOutputArtifactManifestSchema.parse({
      version: 1,
      owner,
      sealed_at_ms: 100,
      retention_until_ms: 200,
      mode: 'pipe',
      stdout: {
        status: 'complete',
        source_completion: 'complete',
        observed_bytes: 6,
        persisted_bytes: 6,
        last_persisted_offset: 6,
        sha256: '0'.repeat(64),
      },
      stderr: {
        status: 'complete',
        source_completion: 'complete',
        observed_bytes: 6,
        persisted_bytes: 6,
        last_persisted_offset: 6,
        sha256: '1'.repeat(64),
      },
    });
    await fsp.writeFile(
      path.join(executionDirectory, relativePaths.manifestFileName),
      JSON.stringify(manifest),
      'utf8',
    );

    await runCommandOutputArtifactStartupMaintenance({ storageRoot, nowMs: 200 });

    await expect(fsp.stat(executionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
