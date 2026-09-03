import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'linnya-package-pack-'));
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

try {
  execFileSync(
    pnpmExecutable,
    ['pack', '--pack-destination', temporaryDirectory],
    { cwd: process.cwd(), stdio: 'inherit' }
  );
  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`workspace package pack 预期生成一个 tarball，实际为 ${archives.length} 个`);
  }
  const archivePath = path.join(temporaryDirectory, archives[0]);
  if (statSync(archivePath).size === 0) {
    throw new Error('workspace package pack 生成了空 tarball');
  }
  console.log(`workspace package pack smoke passed: ${archives[0]}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
