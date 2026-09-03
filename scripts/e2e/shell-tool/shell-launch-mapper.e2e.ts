import assert from 'node:assert/strict';
import process from 'node:process';

import {
  CommandLaunchEnvironmentV1Schema,
  CommandPermissionSnapshotV1Schema,
  CommandResolvedShellV1Schema,
  parseShellCommandProposal,
} from '../../../packages/schemas/src/commands';
import {
  resolveShellInitialWait,
  resolveShellLaunchRequest,
  validateShellCommandInput,
} from '../../../src/domains/commands';

const platform = process.platform === 'win32' ? 'windows' : 'macos';
const identity = {
  conversation_id: 'shell-launch-e2e-conversation',
  agent_run_id: 'shell-launch-e2e-run',
  origin_tool_call_id: 'shell-launch-e2e-tool-call',
  command_execution_id: 'command_execution_30000000-0000-4000-8000-000000000001',
  owner_generation_id: 'command_owner_30000000-0000-4000-8000-000000000002',
  created_at_ms: 1_785_499_200_000,
} as const;

const initialPermission = CommandPermissionSnapshotV1Schema.parse({
  protocol_version: 1,
  kind: 'command_permission_snapshot',
  identity,
  base_level: 'read_only',
  effective_level: 'read_only',
  grant_source: 'global_setting',
  internal_data_access: 'denied',
});
const proposal = parseShellCommandProposal({
  protocol_version: 1,
  kind: 'shell_command_proposal',
  identity,
  command: 'printf "中文 😀\\n"',
  cwd: process.platform === 'win32'
    ? 'C:\\Users\\linnya_test\\conversation 中文'
    : '/tmp/conversation 中文',
  permission: initialPermission,
});
const finalPermission = CommandPermissionSnapshotV1Schema.parse({
  ...initialPermission,
  effective_level: 'standard',
  grant_source: 'allow_once',
});
const shell = CommandResolvedShellV1Schema.parse({
  platform,
  shell_semantics_id: platform === 'windows' ? 'powershell-5.1' : 'zsh',
  shell_version: platform === 'windows' ? '5.1' : '5.9',
  snapshot_revision: 'app-startup-e2e',
  output_text_encoding: 'utf-8',
  command_invocation_profile_id: platform === 'windows'
    ? 'powershell-utf8-v1'
    : 'plain-v1',
  executable_path: platform === 'windows'
    ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    : '/bin/zsh',
  argv_prefix: platform === 'windows'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
    : ['-f', '-c'],
});
const environment = CommandLaunchEnvironmentV1Schema.parse({
  revision: 'app-startup-e2e',
  entries: platform === 'windows'
    ? { PATH: 'C:\\Windows\\System32', TEMP: 'C:\\Temp' }
    : { PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' },
});

assert.equal(validateShellCommandInput({ command: '😀'.repeat(12_000) }).status, 'accepted');
assert.deepEqual(validateShellCommandInput({ command: 'pwd', permission: 'full_access' }), {
  status: 'rejected',
  code: 'invalid_arguments',
});
assert.equal(
  resolveShellInitialWait({ platform, requestedMs: 250 }),
  platform === 'windows' ? 10_000 : 250,
);

const resolved = resolveShellLaunchRequest({
  conversationRoot: proposal.cwd,
  authorized: {
    context: {
      platform,
      shellSemanticsId: shell.shell_semantics_id,
    },
    proposal,
    permission: finalPermission,
  },
  runtime: { shell, environment, hardTimeoutMs: 180_000 },
});
assert.equal(resolved.status, 'resolved');
if (resolved.status !== 'resolved') throw new Error('launch mapper rejected valid E2E facts');
assert.equal(resolved.launch.proposal.command, 'printf "中文 😀\\n"');
assert.equal(resolved.launch.permission.effective_level, 'standard');
assert.equal(resolved.launch.shell.output_text_encoding, 'utf-8');
assert.equal(
  resolved.launch.shell.command_invocation_profile_id,
  platform === 'windows' ? 'powershell-utf8-v1' : 'plain-v1',
);
assert.equal(resolved.launch.stdin, 'closed');
assert(Object.isFrozen(resolved.launch));
assert(Object.isFrozen(resolved.launch.environment.entries));

assert.deepEqual(resolveShellLaunchRequest({
  conversationRoot: proposal.cwd,
  authorized: {
    context: platform === 'windows'
      ? { platform: 'macos', shellSemanticsId: 'zsh' }
      : { platform: 'windows', shellSemanticsId: 'powershell-5.1' },
    proposal,
    permission: finalPermission,
  },
  runtime: { shell, environment, hardTimeoutMs: 180_000 },
}), { status: 'rejected', code: 'authorization_runtime_mismatch' });

shell.argv_prefix.push('-mutated-after-resolution');
environment.entries.PATH = 'mutated-after-resolution';
assert.notEqual(resolved.launch.shell.argv_prefix.at(-1), '-mutated-after-resolution');
assert.notEqual(resolved.launch.environment.entries.PATH, 'mutated-after-resolution');

const duplicateWindowsEnvironment = CommandLaunchEnvironmentV1Schema.parse({
  revision: 'app-startup-e2e',
  entries: { PATH: 'C:\\Windows', Path: 'C:\\Tools' },
});
const windowsShell = CommandResolvedShellV1Schema.parse({
  ...shell,
  platform: 'windows',
  shell_semantics_id: 'powershell-5.1',
  output_text_encoding: 'utf-8',
  command_invocation_profile_id: 'powershell-utf8-v1',
  executable_path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
});
assert.deepEqual(resolveShellLaunchRequest({
  conversationRoot: proposal.cwd,
  authorized: {
    context: {
      platform: 'windows',
      shellSemanticsId: 'powershell-5.1',
    },
    proposal,
    permission: finalPermission,
  },
  runtime: {
    shell: windowsShell,
    environment: duplicateWindowsEnvironment,
    hardTimeoutMs: 180_000,
  },
}), { status: 'rejected', code: 'invalid_launch_context' });

process.stdout.write(`${JSON.stringify({
  ok: true,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  cases: 9,
})}\n`);
