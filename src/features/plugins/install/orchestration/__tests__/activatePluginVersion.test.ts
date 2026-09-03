import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activatePluginVersion,
  readActivePluginPointer,
  rollbackActivePluginVersion,
} from '../activatePluginVersion';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-activate-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePluginVersion(userPluginRoot: string, version: string): void {
  writeJson(path.join(userPluginRoot, 'mindmap', version, 'plugin.json'), {
    id: 'mindmap',
    version,
    name: 'Mindmap',
    description: 'Mindmap plugin',
    developer: 'Linnya',
    details: ['Mindmap plugin details'],
    entry: {
      backend: './dist/backend/index.cjs',
    },
  });
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('activatePluginVersion', () => {
  it('activates a staged version and records the previous version for rollback', () => {
    const userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writePluginVersion(userPluginRoot, '1.1.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });

    const result = activatePluginVersion({
      userPluginRoot,
      pluginId: 'mindmap',
      version: '1.1.0',
    });

    expect(result).toEqual({
      status: 'activated',
      pluginId: 'mindmap',
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(readActivePluginPointer(userPluginRoot, 'mindmap')).toEqual({
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
  });

  it('refuses to activate when active.json changed after preflight', () => {
    const userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writePluginVersion(userPluginRoot, '1.1.0');
    writePluginVersion(userPluginRoot, '1.2.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.2.0' });

    const result = activatePluginVersion({
      userPluginRoot,
      pluginId: 'mindmap',
      version: '1.1.0',
      expectedPreviousVersion: '1.0.0',
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'mindmap',
      version: '1.1.0',
    });
    if (result.status !== 'failed') {
      throw new Error('expected activation to fail');
    }
    expect(result.error).toContain('previousVersion changed during activation');
    expect(readActivePluginPointer(userPluginRoot, 'mindmap')).toEqual({
      version: '1.2.0',
    });
  });

  it('rolls active.json back to the previous version after a failed load', () => {
    const userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writePluginVersion(userPluginRoot, '1.1.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), {
      version: '1.1.0',
      previousVersion: '1.0.0',
    });

    const result = rollbackActivePluginVersion({
      userPluginRoot,
      pluginId: 'mindmap',
      failedVersion: '1.1.0',
    });

    expect(result).toEqual({
      status: 'rolled-back',
      pluginId: 'mindmap',
      fromVersion: '1.1.0',
      toVersion: '1.0.0',
    });
    expect(readActivePluginPointer(userPluginRoot, 'mindmap')).toEqual({
      version: '1.0.0',
    });
  });

  it('does not roll back when the failed version no longer matches active.json', () => {
    const userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });

    const result = rollbackActivePluginVersion({
      userPluginRoot,
      pluginId: 'mindmap',
      failedVersion: '1.1.0',
    });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'failed-version-mismatch',
    });
    expect(readActivePluginPointer(userPluginRoot, 'mindmap')).toEqual({
      version: '1.0.0',
    });
  });
});
