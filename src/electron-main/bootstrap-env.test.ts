import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDevEnv } from './bootstrap-env';

describe('development environment bootstrap', () => {
  const tempDirs: string[] = [];
  const touchedKeys: string[] = [];

  afterEach(async () => {
    for (const key of touchedKeys.splice(0)) delete process.env[key];
    await Promise.all(tempDirs.splice(0).map(dir => fsp.rm(dir, { recursive: true, force: true })));
  });

  async function createEnvironmentRoot(contents: string): Promise<string> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-bootstrap-env-'));
    tempDirs.push(root);
    await fsp.writeFile(path.join(root, '.env.local'), contents);
    return root;
  }

  it('loads repository environment files only for an unpackaged development process', async () => {
    const key = `LINNYA_BOOTSTRAP_TEST_${Date.now()}`;
    touchedKeys.push(key);
    const root = await createEnvironmentRoot(`${key}=development\n`);

    bootstrapDevEnv({ isPackaged: false, developmentRoot: root });

    expect(process.env[key]).toBe('development');
  });

  it('never loads environment files from the packaged process working directory', async () => {
    const key = `LINNYA_PACKAGED_BOOTSTRAP_TEST_${Date.now()}`;
    touchedKeys.push(key);
    const root = await createEnvironmentRoot(`${key}=untrusted\nLINNYA_DEV_MODE=true\n`);
    const previousDevMode = process.env.LINNYA_DEV_MODE;

    bootstrapDevEnv({ isPackaged: true, developmentRoot: root });

    expect(process.env[key]).toBeUndefined();
    expect(process.env.LINNYA_DEV_MODE).toBe(previousDevMode);
  });
});
