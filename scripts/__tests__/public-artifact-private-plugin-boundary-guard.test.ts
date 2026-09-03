import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzePublicHostArtifact,
  runPublicArtifactPrivatePluginBoundaryGuard,
} from '../guards/public-artifact-private-plugin-boundary-guard.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function writeHostArtifacts(mainContent: string, backendContent: string): string {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-public-artifact-boundary-'));
  temporaryRoots.push(temporaryRoot);
  const outputDirectory = path.join(temporaryRoot, 'dist/main');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'main.cjs'), mainContent, 'utf8');
  fs.writeFileSync(path.join(outputDirectory, 'app-server-backend.cjs'), backendContent, 'utf8');
  return temporaryRoot;
}

describe('public Host artifact/private plugin boundary guard', () => {
  it('当前生产 Host bundle 不包含私有插件实现或根 package.json', () => {
    expect(runPublicArtifactPrivatePluginBoundaryGuard()).toEqual([]);
  });

  it('拒绝私有插件源码路径与实现标记', () => {
    expect(analyzePublicHostArtifact(
      'dist/main/app-server-backend.cjs',
      'packages/plugins/supplystrata/src SupplystrataStartResearchTool',
    )).toEqual([
      {
        file: 'dist/main/app-server-backend.cjs',
        fragment: 'packages/plugins/supplystrata/src',
      },
      {
        file: 'dist/main/app-server-backend.cjs',
        fragment: 'SupplystrataStartResearchTool',
      },
    ]);
  });

  it('拒绝根 package.json 脚本被整体内联', () => {
    const temporaryRoot = writeHostArtifacts('test:conversation-semantic-gate', 'public backend');
    expect(runPublicArtifactPrivatePluginBoundaryGuard(temporaryRoot)).toEqual([
      {
        file: 'dist/main/main.cjs',
        fragment: 'test:conversation-semantic-gate',
      },
    ]);
  });

  it('缺少任一生产 Host bundle 时失败，而不是跳过检查', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-public-artifact-missing-'));
    temporaryRoots.push(temporaryRoot);
    expect(() => runPublicArtifactPrivatePluginBoundaryGuard(temporaryRoot))
      .toThrow('公开 Host 产物边界门禁缺少构建产物: dist/main/main.cjs');
  });
});
