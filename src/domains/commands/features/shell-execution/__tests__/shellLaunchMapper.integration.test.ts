import {
  CommandLaunchEnvironmentV1Schema,
  CommandExecutionIdentitySchema,
  CommandPermissionSnapshotV1Schema,
  CommandResolvedShellV1Schema,
  parseShellCommandProposal,
  type CommandExecutionIdentity,
} from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import { resolveShellHardTimeout } from '../functions/resolveShellHardTimeout';
import { resolveShellInitialWait } from '../functions/resolveShellInitialWait';
import { resolveShellLaunchRequest } from '../functions/resolveShellLaunchRequest';
import { validateShellCommandInput } from '../functions/validateShellCommandInput';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OTHER_EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const MACOS_AUTHORIZATION_CONTEXT = Object.freeze({
  platform: 'macos' as const,
  shellSemanticsId: 'zsh',
});

function createIdentity(commandExecutionId = EXECUTION_ID): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: 'conversation-shell-launch',
    agent_run_id: 'run-shell-launch',
    origin_tool_call_id: 'tool-call-shell-launch',
    command_execution_id: commandExecutionId,
    owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c',
    created_at_ms: 1_785_499_200_000,
  });
}

function createPermission(input: {
  readonly identity?: CommandExecutionIdentity;
  readonly baseLevel?: 'read_only' | 'standard' | 'full_access';
  readonly effectiveLevel?: 'read_only' | 'standard' | 'full_access';
  readonly grantSource?: 'global_setting' | 'allow_once' | 'conversation_approval';
  readonly internalDataAccess?: 'allowed' | 'denied';
} = {}) {
  return CommandPermissionSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity: input.identity ?? createIdentity(),
    base_level: input.baseLevel ?? 'read_only',
    effective_level: input.effectiveLevel ?? 'read_only',
    grant_source: input.grantSource ?? 'global_setting',
    internal_data_access: input.internalDataAccess ?? 'denied',
  });
}

function createProposal() {
  const identity = createIdentity();
  return parseShellCommandProposal({
    protocol_version: 1,
    kind: 'shell_command_proposal',
    identity,
    command: 'printf "中文 😀\\n"',
    cwd: '/tmp/linnya conversation',
    permission: createPermission({ identity }),
  });
}

function createShell(input: {
  readonly platform?: 'macos' | 'windows';
  readonly shellSemanticsId?: string;
  readonly snapshotRevision?: string;
} = {}) {
  const platform = input.platform ?? 'macos';
  return CommandResolvedShellV1Schema.parse({
    platform,
    shell_semantics_id: input.shellSemanticsId
      ?? (platform === 'macos' ? 'zsh' : 'powershell-5.1'),
    shell_version: platform === 'macos' ? '5.9' : '5.1.26100.7019',
    snapshot_revision: input.snapshotRevision ?? 'app-startup-a',
    output_text_encoding: 'utf-8',
    command_invocation_profile_id: platform === 'macos'
      ? 'plain-v1'
      : 'powershell-utf8-v1',
    executable_path: platform === 'macos'
      ? '/bin/zsh'
      : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    argv_prefix: platform === 'macos'
      ? ['-f', '-c']
      : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
  });
}

function createEnvironment(input: {
  readonly revision?: string;
  readonly entries?: Record<string, string>;
} = {}) {
  return CommandLaunchEnvironmentV1Schema.parse({
    revision: input.revision ?? 'app-startup-a',
    entries: input.entries ?? { PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' },
  });
}

describe('shell command input validation', () => {
  it('accepts the exact Unicode budget and resolves the default initial wait', () => {
    const result = validateShellCommandInput({ command: '😀'.repeat(12_000) });

    expect(result).toEqual({
      status: 'accepted',
      input: {
        command: '😀'.repeat(12_000),
        interactive: false,
        requiresWriteAccess: false,
        initialWaitMs: 10_000,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.status === 'accepted' && Object.isFrozen(result.input)).toBe(true);
  });

  it.each([
    [{}, 'invalid_command'],
    [{ command: `printf 'bad\0value'` }, 'invalid_command'],
    [{ command: '😀'.repeat(12_001) }, 'invalid_command'],
    [{ command: 'pwd', cwd: '   ' }, 'invalid_cwd'],
    [{ command: 'pwd', initial_wait_ms: 30_001 }, 'invalid_initial_wait'],
    [{ command: 'pwd', hard_timeout_seconds: 0 }, 'invalid_hard_timeout'],
    [{ command: 'pwd', hard_timeout_seconds: 601 }, 'invalid_hard_timeout'],
    [{ command: 'pwd', requires_write_access: 'yes' }, 'invalid_arguments'],
    [{ command: 'pwd', permission: 'full_access' }, 'invalid_arguments'],
  ] as const)('projects invalid Agent input to a stable code', (value, code) => {
    expect(validateShellCommandInput(value)).toEqual({ status: 'rejected', code });
  });

  it('keeps Windows transport floor separate from the Agent requested wait', () => {
    expect(resolveShellInitialWait({ platform: 'macos', requestedMs: 250 })).toBe(250);
    expect(resolveShellInitialWait({ platform: 'windows', requestedMs: 250 })).toBe(10_000);
    expect(resolveShellInitialWait({ platform: 'windows', requestedMs: 30_000 })).toBe(30_000);
  });

  it('把单条秒数转为毫秒，并让 host 默认值与最大值保持最终决定权', () => {
    const runtime = {
      shell: createShell(),
      environment: createEnvironment(),
      defaultHardTimeoutMs: 180_000,
      maximumHardTimeoutMs: 600_000,
    };
    expect(resolveShellHardTimeout({ runtime })).toEqual({
      status: 'resolved',
      hardTimeoutMs: 180_000,
    });
    expect(resolveShellHardTimeout({ runtime, requestedHardTimeoutMs: 1_000 })).toEqual({
      status: 'resolved',
      hardTimeoutMs: 1_000,
    });
    expect(resolveShellHardTimeout({ runtime, requestedHardTimeoutMs: 600_000 })).toEqual({
      status: 'resolved',
      hardTimeoutMs: 600_000,
    });
    expect(resolveShellHardTimeout({ runtime, requestedHardTimeoutMs: 600_001 })).toEqual({
      status: 'rejected',
      code: 'hard_timeout_exceeds_host_limit',
    });
  });
});

describe('authorized shell launch mapper', () => {
  it('preserves the approved command and final permission in a frozen launch snapshot', () => {
    const proposal = createProposal();
    const permission = createPermission({
      effectiveLevel: 'standard',
      grantSource: 'allow_once',
    });
    const shell = createShell();
    const environment = createEnvironment();
    const result = resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: { context: MACOS_AUTHORIZATION_CONTEXT, proposal, permission },
      runtime: { shell, environment, hardTimeoutMs: 180_000 },
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('launch fixture must resolve');
    expect(result.launch.proposal.command).toBe('printf "中文 😀\\n"');
    expect(result.launch.conversation_root).toBe('/tmp/linnya conversation');
    expect(result.launch.permission.effective_level).toBe('standard');
    expect(result.launch.shell.output_text_encoding).toBe('utf-8');
    expect(result.launch.shell.command_invocation_profile_id).toBe('plain-v1');
    expect(result.launch.stdin).toBe('closed');
    expect(Object.isFrozen(result.launch)).toBe(true);
    expect(Object.isFrozen(result.launch.proposal)).toBe(true);
    expect(Object.isFrozen(result.launch.shell.argv_prefix)).toBe(true);
    expect(Object.isFrozen(result.launch.environment.entries)).toBe(true);

    shell.argv_prefix.push('-changed-after-resolution');
    environment.entries.PATH = '/changed/after/resolution';
    expect(result.launch.shell.argv_prefix).toEqual(['-f', '-c']);
    expect(result.launch.environment.entries.PATH).toBe('/usr/bin:/bin');
    expect(() => result.launch.shell.argv_prefix.push('-mutate-frozen-launch')).toThrow();
  });

  it('rejects permission identity or scope changes before constructing a launch', () => {
    const proposal = createProposal();
    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: {
        context: MACOS_AUTHORIZATION_CONTEXT,
        proposal,
        permission: createPermission({ identity: createIdentity(OTHER_EXECUTION_ID) }),
      },
      runtime: {
        shell: createShell(),
        environment: createEnvironment(),
        hardTimeoutMs: 180_000,
      },
    })).toEqual({ status: 'rejected', code: 'authorization_identity_mismatch' });

    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: {
        context: MACOS_AUTHORIZATION_CONTEXT,
        proposal,
        permission: createPermission({
          baseLevel: 'standard',
          effectiveLevel: 'standard',
        }),
      },
      runtime: {
        shell: createShell(),
        environment: createEnvironment(),
        hardTimeoutMs: 180_000,
      },
    })).toEqual({ status: 'rejected', code: 'authorization_scope_mismatch' });
  });

  it('rejects mixed runtime revisions and invalid runtime facts without fallback', () => {
    const proposal = createProposal();
    const permission = createPermission();
    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: { context: MACOS_AUTHORIZATION_CONTEXT, proposal, permission },
      runtime: {
        shell: createShell({ snapshotRevision: 'app-startup-a' }),
        environment: createEnvironment({ revision: 'app-startup-b' }),
        hardTimeoutMs: 180_000,
      },
    })).toEqual({ status: 'rejected', code: 'runtime_snapshot_mismatch' });

    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: { context: MACOS_AUTHORIZATION_CONTEXT, proposal, permission },
      runtime: {
        shell: createShell(),
        environment: createEnvironment(),
        hardTimeoutMs: 0,
      },
    })).toEqual({ status: 'rejected', code: 'invalid_launch_context' });
  });

  it('rejects environment entries that cannot be passed safely to the platform', () => {
    expect(CommandLaunchEnvironmentV1Schema.safeParse({
      revision: 'app-startup-a',
      entries: { 'BAD=KEY': 'value' },
    }).success).toBe(false);
    expect(CommandLaunchEnvironmentV1Schema.safeParse({
      revision: 'app-startup-a',
      entries: { PATH: 'bad\0value' },
    }).success).toBe(false);

    const proposal = createProposal();
    const permission = createPermission();
    const duplicateWindowsEnvironment = createEnvironment({
      entries: { PATH: 'C:\\Windows', Path: 'C:\\Tools' },
    });
    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: {
        context: {
          platform: 'windows',
          shellSemanticsId: 'powershell-5.1',
        },
        proposal,
        permission,
      },
      runtime: {
        shell: createShell({ platform: 'windows' }),
        environment: duplicateWindowsEnvironment,
        hardTimeoutMs: 180_000,
      },
    })).toEqual({ status: 'rejected', code: 'invalid_launch_context' });
  });

  it('rejects a runtime that would reinterpret a command after authorization', () => {
    const proposal = createProposal();
    const permission = createPermission();

    expect(resolveShellLaunchRequest({
      conversationRoot: '/tmp/linnya conversation',
      authorized: { context: MACOS_AUTHORIZATION_CONTEXT, proposal, permission },
      runtime: {
        shell: createShell({ platform: 'windows' }),
        environment: createEnvironment(),
        hardTimeoutMs: 180_000,
      },
    })).toEqual({ status: 'rejected', code: 'authorization_runtime_mismatch' });
  });
});
