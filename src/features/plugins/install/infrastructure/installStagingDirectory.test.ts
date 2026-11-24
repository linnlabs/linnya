import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInstallStagingPath, removeAbandonedInstallStaging } from './installStagingDirectory';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-install-staging-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('安装临时目录的清理', () => {
  it('只清理进程已经不在的安装留下的目录', () => {
    const exited = spawnSync(process.execPath, ['-e', '']).pid;
    const abandoned = path.join(root, `.install-1.14.1.${exited}.1795522179240`);
    fs.mkdirSync(abandoned);
    fs.writeFileSync(path.join(abandoned, 'artifact.zip'), 'partial');
    const running = createInstallStagingPath(root, '1.14.1');
    const kept = [running, path.join(root, '1.14.1'), path.join(root, '.receipts'), path.join(root, '.install-notes')];
    for (const directory of kept) fs.mkdirSync(directory);

    removeAbandonedInstallStaging(root);

    expect(fs.existsSync(abandoned)).toBe(false);
    for (const directory of kept) expect(fs.existsSync(directory)).toBe(true);
  });

  it('安装目录还不存在时不做任何事', () => {
    expect(() => removeAbandonedInstallStaging(path.join(root, 'missing'))).not.toThrow();
  });
});
