import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMacOsSandboxedOwnedPipeCommandProcess } from '../../../../../src/infra/adapters/command-runtime/macos/createMacOsSandboxedOwnedPipeCommandProcess';

const [runRoot, runToken] = process.argv.slice(2);
if (!runRoot || !runToken) {
  throw new Error('macOS owned-process host requires run root and run token');
}

const treeFixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'macos-process-group-tree.cjs',
);
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const ownedProcess = await createMacOsSandboxedOwnedPipeCommandProcess({
  executablePath: process.execPath,
  argv: [treeFixturePath, runRoot, runToken, 'ignore-term'],
  cwd: runRoot,
  conversationRoot: runRoot,
  environment,
  permissionLevel: 'standard',
});
ownedProcess.stdout.resume();
ownedProcess.stderr.resume();

const readyPath = path.join(runRoot, 'owner-ready.json');
const tempPath = `${readyPath}.${randomUUID()}.tmp`;
await writeFile(tempPath, JSON.stringify({
  version: 1,
  runToken,
  ownerPid: process.pid,
}), 'utf8');
await rename(tempPath, readyPath);

// E2E 会直接 SIGKILL 本进程。这里故意不注册清理回调，证明内核关闭 owner pipe 后
// watchdog 仍能独立收掉业务进程组。
await new Promise<void>(() => {});
