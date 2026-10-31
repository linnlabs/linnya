import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PipeCommandLaunchSnapshotV1Schema, PtyCommandLaunchSnapshotV1Schema, type CommandPermissionLevel } from '@app/schemas/commands';
import { createCommandRunnerPlatformLauncher } from '../../../../../src/infra/adapters/command-runtime/platform-runtime/orchestration/createCommandRunnerPlatformLauncher';
import type { OwnedPipeProcess } from '../../../../../src/shared/process-runtime';

// 运行正式 TS 路由、manifest loader、PowerShell wrapper 和 native owner，不直接调用 N-API。
const [manifestPath, suiteRoot] = process.argv.slice(2);
assert.ok(manifestPath && suiteRoot);
const current = path.join(suiteRoot, 'current');
const helperPath = path.join(path.dirname(manifestPath), 'linnyaCommandIsolation.exe');
const environment: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('=')) environment[key] = value;
const platform = () => createCommandRunnerPlatformLauncher({
  schema_version: 1, platform: 'win32', manifest_path: manifestPath,
  expected_runtime_version: '0.1.0', expected_application_version: '0.1.0', trust: { kind: 'development' },
});
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
function snapshot(source: string, level: CommandPermissionLevel, approved = false) {
  const identity = {
    conversation_id: 'isolation-platform-test', agent_run_id: 'isolation-platform-test',
    origin_tool_call_id: randomUUID(), command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`, created_at_ms: Date.now(),
  };
  const permission = {
    protocol_version: 1, kind: 'command_permission_snapshot', identity,
    base_level: level, effective_level: level, grant_source: approved ? 'allow_once' : 'global_setting',
    internal_data_access: 'denied', internal_storage_access: approved,
  };
  return {
    protocol_version: 1, conversation_root: current,
    internal_storage: { protected_roots: [suiteRoot], readable_roots: [] },
    proposal: { protocol_version: 1, kind: 'shell_command_proposal', identity,
      command: `& ${quote(process.execPath)} -e ${quote(source)}\nexit $LASTEXITCODE`,
      cwd: current, permission: { ...permission, grant_source: 'global_setting', internal_storage_access: false }, requests_internal_storage_access: approved },
    permission,
    shell: {
      platform: 'windows', shell_semantics_id: 'powershell-5.1', shell_version: '5.1',
      snapshot_revision: 'isolation-v1', output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'powershell-utf8-v1',
      executable_path: path.join(environment.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
    },
    environment: { revision: 'isolation-v1', entries: environment },
    lifecycle_policy: 'terminate_with_run', hard_timeout_ms: 45_000,
  };
}

function deadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), 45_000);
  })]).finally(() => clearTimeout(timer));
}

async function launch(source: string, level: CommandPermissionLevel, approved = false) {
  const before = Date.now();
  const owner = await deadline(platform().launchOwnedPipeProcess(PipeCommandLaunchSnapshotV1Schema.parse({
    ...snapshot(source, level, approved), kind: 'pipe_command_launch_snapshot', mode: 'pipe', stdin: 'closed',
  })), 'launch');
  const chunks: Buffer[] = [];
  owner.stdout.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  owner.stderr.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return { owner, output: () => Buffer.concat(chunks).toString('utf8'), prepareMs: Date.now() - before };
}

async function settle(run: { owner: OwnedPipeProcess; output(): string }) {
  let exit;
  try { exit = await deadline(run.owner.rootExit, 'root exit'); }
  finally {
    assert.deepEqual(await deadline(run.owner.stopAndWaitForTreeEmpty(), 'tree'), { status: 'succeeded' });
    assert.deepEqual(await deadline(run.owner.release(), 'release'), { status: 'succeeded' });
  }
  assert.equal(exit.exitCode, 0, run.output());
  return run.output();
}

async function run() {
  await mkdir(current, { recursive: true });
  await writeFile(path.join(suiteRoot, 'secret.txt'), 'SYNTHETIC_SECRET');
  await writeFile(path.join(current, 'input.txt'), 'INPUT');
  const denied = `const fs=require('fs');try{fs.readFileSync('../secret.txt');throw Error('LEAK')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}console.log('DENIED');`;
  let running = await launch(denied + `fs.writeFileSync('output.txt','OK');`, 'standard');
  assert.match(await settle(running), /DENIED/);
  console.log(`PASS platform standard with ambient home ${homedir()}: ${running.prepareMs}ms`);
  running = await launch(denied + `try{fs.writeFileSync('readonly.txt','BAD');throw Error('WRITE LEAK')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}`, 'read_only');
  assert.match(await settle(running), /DENIED/);
  console.log('PASS platform readonly');
  await rm(path.join(suiteRoot, 'finish-approved'), { force: true });
  const approved = await launch(`const fs=require('fs');if(fs.readFileSync('../secret.txt','utf8')!=='SYNTHETIC_SECRET')throw Error('approved read');console.log('APPROVED');setInterval(()=>{if(fs.existsSync('../finish-approved'))process.exit(0)},30)`, 'standard', true);
  let approvedDone = false;
  void approved.owner.rootExit.then(() => { approvedDone = true; });
  running = await launch(denied, 'standard');
  assert.equal(approvedDone, false, 'parallel commands must not wait for the approved command');
  assert.match(await settle(running), /DENIED/);
  await writeFile(path.join(suiteRoot, 'finish-approved'), 'done');
  assert.match(await settle(approved), /APPROVED/);
  assert.match(await settle(await launch(denied, 'standard')), /DENIED/);
  console.log('PASS platform parallel approval and later denial');
  const terminal = await deadline(platform().launchOwnedPtyProcess(PtyCommandLaunchSnapshotV1Schema.parse({
    ...snapshot(`console.log('PTY_READY');process.stdin.once('data',()=>{console.log('PTY_DONE');process.exit(0)})`, 'standard'),
    kind: 'pty_command_launch_snapshot', mode: 'pty', stdin: 'pty', terminal_size: { columns: 80, rows: 24 },
  })), 'PTY launch');
  let output = '';
  terminal.terminal.on('data', data => { output += Buffer.from(data).toString('utf8'); });
  await deadline((async () => { while (!output.includes('PTY_READY')) await delay(20); })(), 'PTY ready');
  await terminal.interact({ type: 'resize', columns: 100, rows: 36 });
  await terminal.interact({ type: 'submit', input: 'hello' });
  assert.equal((await deadline(terminal.rootExit, 'PTY root')).exitCode, 0);
  assert.deepEqual(await terminal.stopAndWaitForTreeEmpty(), { status: 'succeeded' });
  assert.deepEqual(await terminal.release(), { status: 'succeeded' });
  assert.match(output, /PTY_DONE/);
  console.log('PASS platform ConPTY input/resize/release');
  await rename(helperPath, `${helperPath}.disabled`);
  try {
    running = await launch(`console.log(require('fs').readFileSync('../secret.txt','utf8'))`, 'full_access');
    assert.match(await settle(running), /SYNTHETIC_SECRET/);
    await assert.rejects(launch(denied, 'standard'), /native|owner|runtime/);
  } finally { await rename(`${helperPath}.disabled`, helperPath); }
  assert.equal(await readFile(path.join(current, 'output.txt'), 'utf8'), 'OK');
  console.log('PASS missing helper: full access succeeds; restricted access fails closed');
}

void run().catch(error => { console.error(error); process.exitCode = 1; });
