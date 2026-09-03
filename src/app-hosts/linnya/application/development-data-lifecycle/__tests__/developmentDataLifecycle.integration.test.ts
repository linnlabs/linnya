import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNodeDevelopmentDataFilesystem } from '../../../adapters/development-data-filesystem/createNodeDevelopmentDataFilesystem';
import {
  CURRENT_DEVELOPMENT_DATA_EPOCH,
  DEVELOPMENT_DATA_STATE_FILE_NAME,
  DevelopmentDataAdmissionError,
  createDevelopmentDataLifecycle,
  parseDevelopmentDataState,
} from '..';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-development-data-'));
  tempRoots.push(root);
  return root;
}

function createLifecycle() {
  return createDevelopmentDataLifecycle({
    filesystem: createNodeDevelopmentDataFilesystem(),
    now: () => new Date('2026-08-18T12:00:00.000Z'),
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('development data lifecycle', () => {
  it('creates the current epoch before any domain data exists and admits the next startup', async () => {
    const developmentRoot = await makeTempRoot();
    const lifecycle = createLifecycle();

    await expect(
      lifecycle.ensureReady({
        developmentRoot,
        appVersion: '0.0.38',
      })
    ).resolves.toEqual({
      epoch: CURRENT_DEVELOPMENT_DATA_EPOCH,
      created_at: '2026-08-18T12:00:00.000Z',
      app_version: '0.0.38',
    });

    const statePath = path.join(developmentRoot, '_dev_data', DEVELOPMENT_DATA_STATE_FILE_NAME);
    const stateSource = await fs.readFile(statePath, 'utf8');
    expect(parseDevelopmentDataState(stateSource)).toMatchObject({
      kind: 'valid',
      state: { epoch: CURRENT_DEVELOPMENT_DATA_EPOCH },
    });

    await fs.writeFile(path.join(developmentRoot, '_dev_data', 'domain-data.txt'), 'current');
    await expect(
      lifecycle.ensureReady({
        developmentRoot,
        appVersion: '0.0.39',
      })
    ).resolves.toMatchObject({
      epoch: CURRENT_DEVELOPMENT_DATA_EPOCH,
      app_version: '0.0.38',
    });
  });

  it('rejects a legacy non-empty root before domain initialization and keeps its data untouched', async () => {
    const developmentRoot = await makeTempRoot();
    const dataRoot = path.join(developmentRoot, '_dev_data');
    await fs.mkdir(dataRoot);
    await fs.writeFile(path.join(dataRoot, 'workspace.sqlite'), 'legacy');

    await expect(
      createLifecycle().ensureReady({
        developmentRoot,
        appVersion: '0.0.38',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: DevelopmentDataAdmissionError.name,
        message: expect.stringContaining('pnpm run dev:data:reset'),
      })
    );
    await expect(fs.readFile(path.join(dataRoot, 'workspace.sqlite'), 'utf8')).resolves.toBe(
      'legacy'
    );
  });

  it('rejects the previous development epoch instead of attempting a compatibility path', async () => {
    const developmentRoot = await makeTempRoot();
    const dataRoot = path.join(developmentRoot, '_dev_data');
    await fs.mkdir(dataRoot);
    await fs.writeFile(
      path.join(dataRoot, DEVELOPMENT_DATA_STATE_FILE_NAME),
      JSON.stringify({
        epoch: CURRENT_DEVELOPMENT_DATA_EPOCH - 1,
        created_at: '2026-08-18T11:00:00.000Z',
        app_version: 'future',
      })
    );

    await expect(
      createLifecycle().ensureReady({
        developmentRoot,
        appVersion: '0.0.38',
      })
    ).rejects.toThrow(`当前要求 epoch：${CURRENT_DEVELOPMENT_DATA_EPOCH}`);
  });

  it('retires the whole root as one recoverable unit and lets the next startup create a clean epoch', async () => {
    const developmentRoot = await makeTempRoot();
    const dataRoot = path.join(developmentRoot, '_dev_data');
    await fs.mkdir(path.join(dataRoot, 'Models'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'workspace.sqlite'), 'database');
    await fs.writeFile(path.join(dataRoot, 'Models', 'user_models.json'), 'models');
    const lifecycle = createLifecycle();

    const result = await lifecycle.reset({ developmentRoot });
    expect(result).toMatchObject({
      status: 'retired',
      dataRoot,
      topLevelEntries: ['Models', 'workspace.sqlite'],
    });
    expect(result.byteSize).toBeGreaterThan(0);
    await expect(fs.stat(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.readFile(path.join(result.retiredPath ?? '', 'workspace.sqlite'), 'utf8')
    ).resolves.toBe('database');

    await expect(
      lifecycle.ensureReady({
        developmentRoot,
        appVersion: '0.0.38',
      })
    ).resolves.toMatchObject({ epoch: CURRENT_DEVELOPMENT_DATA_EPOCH });
    await expect(fs.readdir(dataRoot)).resolves.toEqual([DEVELOPMENT_DATA_STATE_FILE_NAME]);
  });
});
