import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  CommandAgentRunIdSchema,
  CommandExecutionIdentitySchema,
} from '../../../packages/schemas/src/commands';
import { createChildRunToolContext } from '../../../packages/linnkit/src/runtime-kernel/child-runs/childToolContext';

import { resolveCommandRunPermissionContext } from '../../../src/app-hosts/linnya/adapters/context-injection/commandRunPermissionContextBinding';
import {
  createInitialCommandPermissionSnapshot,
  readCommandPermissionSettings,
  updateCommandPermissionSettings,
} from '../../../src/domains/commands/features/permission-settings';
import { createJsonFileCommandPermissionSettingsPort } from '../../../src/infra/adapters/command-permission-settings/json-file';

const runRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), 'linnya-permission-settings-e2e-中文 path-'),
);
let succeeded = false;

function readInheritedPermission(context: object): unknown {
  return 'commandRunPermission' in context
    ? context.commandRunPermission
    : undefined;
}

try {
  const filePath = path.join(runRoot, 'config with spaces', 'command_permission.json');
  const port = createJsonFileCommandPermissionSettingsPort({ filePath });
  assert.deepEqual(readCommandPermissionSettings(port), {
    schema_version: 1,
    kind: 'command_permission_settings',
    revision: 0,
    permission_level: 'standard',
    internal_data_access: 'allowed',
    gui_control: 'denied',
    local_ipc_control: 'denied',
    process_lifecycle: 'terminate_with_run',
  });

  const firstOwner = {};
  const first = resolveCommandRunPermissionContext({
    runOwner: firstOwner,
    executionKind: 'start',
    rootAgentRunId: CommandAgentRunIdSchema.parse('permission-e2e-root-first'),
    settingsPort: port,
    now: () => 100,
  });
  assert.equal(first.status, 'available');
  if (first.status !== 'available') throw new Error('first snapshot unavailable');
  assert.equal(first.snapshot.permission_level, 'standard');
  assert(Object.isFrozen(first));
  assert(Object.isFrozen(first.snapshot));

  updateCommandPermissionSettings({
    port,
    update: {
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 0,
      permission_level: 'full_access',
      internal_data_access: 'denied',
    },
  });
  const resumed = resolveCommandRunPermissionContext({
    runOwner: firstOwner,
    executionKind: 'resume',
    rootAgentRunId: CommandAgentRunIdSchema.parse('permission-e2e-root-first'),
    settingsPort: port,
    now: () => 200,
  });
  assert.strictEqual(resumed, first);
  assert.equal(resumed.status === 'available' && resumed.snapshot.permission_level, 'standard');

  const parentToolContext = { commandRunPermission: first };
  const childContext = createChildRunToolContext({
    parentToolContext,
    conversationId: 'permission-e2e-conversation',
    turnId: 'permission-e2e-turn',
    runId: RunIdSchema.parse('permission-e2e-child'),
    parentRunId: RunIdSchema.parse('permission-e2e-root-first'),
    userQuery: 'child',
    modelId: 'model-test',
    seedHistory: [],
  });
  assert.strictEqual(readInheritedPermission(childContext), first);

  const second = resolveCommandRunPermissionContext({
    runOwner: {},
    executionKind: 'start',
    rootAgentRunId: CommandAgentRunIdSchema.parse('permission-e2e-root-second'),
    settingsPort: createJsonFileCommandPermissionSettingsPort({ filePath }),
    now: () => 300,
  });
  assert.equal(second.status, 'available');
  if (second.status !== 'available') throw new Error('second snapshot unavailable');
  assert.equal(second.snapshot.settings_revision, 1);
  assert.equal(second.snapshot.permission_level, 'full_access');
  assert.equal(second.snapshot.internal_data_access, 'denied');
  const executionIdentity = CommandExecutionIdentitySchema.parse({
    conversation_id: 'permission-e2e-conversation',
    agent_run_id: 'permission-e2e-root-second',
    origin_tool_call_id: 'permission-e2e-tool-call',
    command_execution_id: 'command_execution_20000000-0000-4000-8000-000000000001',
    owner_generation_id: 'command_owner_20000000-0000-4000-8000-000000000002',
    created_at_ms: 301,
  });
  assert.deepEqual(createInitialCommandPermissionSnapshot({
    runSnapshot: second.snapshot,
    identity: executionIdentity,
  }), {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity: executionIdentity,
    base_level: 'full_access',
    effective_level: 'full_access',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  });

  await fsp.writeFile(filePath, '{bad-json', 'utf8');
  const corrupt = resolveCommandRunPermissionContext({
    runOwner: {},
    executionKind: 'start',
    rootAgentRunId: CommandAgentRunIdSchema.parse('permission-e2e-root-corrupt'),
    settingsPort: createJsonFileCommandPermissionSettingsPort({ filePath }),
  });
  assert.deepEqual(corrupt, {
    status: 'unavailable',
    code: 'permission_settings_unavailable',
    reason: 'invalid_config',
  });

  let resumeReadCount = 0;
  const missingResume = resolveCommandRunPermissionContext({
    runOwner: {},
    executionKind: 'resume',
    rootAgentRunId: CommandAgentRunIdSchema.parse('permission-e2e-root-missing'),
    settingsPort: {
      read: () => {
        resumeReadCount += 1;
        return { status: 'missing' };
      },
      write: () => ({ status: 'written' }),
    },
  });
  assert.equal(resumeReadCount, 0);
  assert.deepEqual(missingResume, {
    status: 'unavailable',
    code: 'permission_settings_unavailable',
    reason: 'run_snapshot_missing',
  });

  succeeded = true;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    platform: process.platform,
    cases: 8,
  })}\n`);
} finally {
  if (succeeded) {
    await fsp.rm(runRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(`permission settings harness failed; evidence preserved at ${runRoot}\n`);
  }
}
