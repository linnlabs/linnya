import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createMacOsSandboxedOwnedPtyCommandProcess } from '../../../../src/infra/adapters/command-runtime/macos/createMacOsSandboxedOwnedPtyCommandProcess';

const [runRoot, processTreeFixture] = process.argv.slice(2);
if (!runRoot || !processTreeFixture) {
  throw new Error('macOS owned PTY host requires run root and process-tree fixture');
}

const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
  executablePath: process.execPath,
  argv: [processTreeFixture, runRoot, 'owner-death', 'ignore-term'],
  cwd: runRoot,
  conversationRoot: runRoot,
  environment,
  permissionLevel: 'full_access',
  terminalSize: { columns: 80, rows: 24 },
});

// 该 host 故意不注册 SIGTERM/SIGINT 清理；E2E 会直接 SIGKILL 它，证明 FIFO
// 生命线而不是 JavaScript finally 负责回收业务进程组。
owned.terminal.resume();
const identityPaths = ['parent', 'child', 'grandchild'].map(
  role => path.join(runRoot, `${role}.json`),
);
const deadline = Date.now() + 5_000;
while (Date.now() < deadline) {
  const present = await Promise.all(identityPaths.map(async (identityPath) => {
    try {
      await fsp.access(identityPath);
      return true;
    } catch {
      return false;
    }
  }));
  if (present.every(Boolean)) {
    await fsp.writeFile(path.join(runRoot, 'owner-ready'), String(process.pid), 'utf8');
    await new Promise<never>(() => {});
  }
  await new Promise<void>(resolve => setTimeout(resolve, 20));
}
throw new Error('macOS owned PTY host did not observe its complete process tree');
