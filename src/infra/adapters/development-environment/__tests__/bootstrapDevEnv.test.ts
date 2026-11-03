import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDevEnv } from '../functions/bootstrapDevEnv';

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

  it('Runtime 环境快照按进程、local、env 优先级补齐，不修改父进程', async () => {
    const key = `LINNYA_RUNTIME_BOOTSTRAP_TEST_${Date.now()}`;
    const root = await createEnvironmentRoot(`${key}=local\nLINNYA_AUDIT_LEVEL=response\n`);
    await fsp.writeFile(path.join(root, '.env'), `${key}=shared\nSHARED_TEST_VALUE=shared\n`);
    const environment: NodeJS.ProcessEnv = { LINNYA_AUDIT_LEVEL: 'behavior' };
    bootstrapDevEnv({ isPackaged: false, developmentRoot: root, environment });
    expect(environment).toMatchObject({
      [key]: 'local', LINNYA_AUDIT_LEVEL: 'behavior', SHARED_TEST_VALUE: 'shared',
    });
    expect(process.env[key]).toBeUndefined();
  });
});
