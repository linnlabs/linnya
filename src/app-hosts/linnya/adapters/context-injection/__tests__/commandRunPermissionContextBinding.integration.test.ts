import { describe, expect, it } from 'vitest';
import { RunIdSchema } from 'linnkit/contracts';
import { CommandAgentRunIdSchema } from '@app/schemas/commands';
import { createChildRunToolContext } from 'packages/linnkit/src/runtime-kernel/child-runs/childToolContext';

import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  serializeCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import { resolveCommandRunPermissionContext } from '../commandRunPermissionContextBinding';

function createMutablePort(): {
  readonly port: CommandPermissionSettingsPort;
  setSerialized(value: string): void;
  readCount(): number;
} {
  let serialized: string | undefined = serializeCommandPermissionSettings(
    DEFAULT_COMMAND_PERMISSION_SETTINGS
  );
  let reads = 0;
  return {
    port: {
      read: () => {
        reads += 1;
        return serialized === undefined ? { status: 'missing' } : { status: 'found', serialized };
      },
      write: value => {
        serialized = value;
        return { status: 'written' };
      },
    },
    setSerialized: value => {
      serialized = value;
    },
    readCount: () => reads,
  };
}

function readCommandRunPermission(context: object): unknown {
  return 'commandRunPermission' in context ? context.commandRunPermission : undefined;
}

describe('command run permission context binding', () => {
  it('同一根 run 恢复和 child run 沿用首次快照，新根 run 才读取新设置', () => {
    const settings = createMutablePort();
    const firstOwner = {};
    const first = resolveCommandRunPermissionContext({
      runOwner: firstOwner,
      executionKind: 'start',
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_permission_first'),
      settingsPort: settings.port,
      now: () => 100,
    });
    expect(first).toMatchObject({
      status: 'available',
      snapshot: {
        settings_revision: 0,
        permission_level: 'standard',
        captured_at_ms: 100,
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status !== 'available') throw new Error('expected available permission context');
    expect(Object.isFrozen(first.snapshot)).toBe(true);

    settings.setSerialized(
      JSON.stringify({
        schema_version: 1,
        kind: 'command_permission_settings',
        revision: 1,
        permission_level: 'full_access',
        internal_data_access: 'denied',
        gui_control: 'denied',
        local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      })
    );
    const resumed = resolveCommandRunPermissionContext({
      runOwner: firstOwner,
      executionKind: 'resume',
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_permission_first'),
      settingsPort: settings.port,
      now: () => 200,
    });
    expect(resumed).toBe(first);
    expect(settings.readCount()).toBe(1);

    const parentToolContext = { commandRunPermission: first };
    const childContext = createChildRunToolContext({
      parentToolContext,
      conversationId: 'permission-context-conversation',
      turnId: 'permission-context-turn',
      runId: RunIdSchema.parse('run_permission_child'),
      parentRunId: RunIdSchema.parse('run_permission_first'),
      userQuery: 'child',
      modelId: 'model-test',
      seedHistory: [],
    });
    expect(readCommandRunPermission(childContext)).toBe(first);

    const second = resolveCommandRunPermissionContext({
      runOwner: {},
      executionKind: 'start',
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_permission_second'),
      settingsPort: settings.port,
      now: () => 300,
    });
    expect(second).toMatchObject({
      status: 'available',
      snapshot: {
        settings_revision: 1,
        permission_level: 'full_access',
        internal_data_access: 'denied',
        captured_at_ms: 300,
      },
    });
    expect(settings.readCount()).toBe(2);
  });

  it('缺失旧绑定的 resume 明确不可用且绝不重读当前全局设置', () => {
    const settings = createMutablePort();
    const resumed = resolveCommandRunPermissionContext({
      runOwner: {},
      executionKind: 'resume',
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_missing_permission_snapshot'),
      settingsPort: settings.port,
    });
    expect(resumed).toEqual({
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'run_snapshot_missing',
    });
    expect(settings.readCount()).toBe(0);
  });
});
