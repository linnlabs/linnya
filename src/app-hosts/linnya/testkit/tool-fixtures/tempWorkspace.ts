import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { resetWorkspaceRootToDefault, setWorkspaceRoot } from 'src/shared/utils/pathManager';

export interface TempWorkspaceFixture {
  root: string;
  cleanup(): Promise<void>;
}

export async function createTempWorkspaceFixture(prefix: string): Promise<TempWorkspaceFixture> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  setWorkspaceRoot(root);

  return {
    root,
    async cleanup(): Promise<void> {
      resetWorkspaceRootToDefault();
      await fsp.rm(root, { recursive: true, force: true });
    },
  };
}
