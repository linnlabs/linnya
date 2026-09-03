import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzePublicOwnerSourceForPrivatePluginReferences,
  runPublicPackagePrivatePluginBoundaryGuard,
} from '../guards/public-package-private-plugin-boundary-guard';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe('public package/private plugin source boundary guard', () => {
  it('当前公开 package 与 app 保持闭源插件源码零依赖', () => {
    expect(runPublicPackagePrivatePluginBoundaryGuard()).toEqual([]);
  });

  it('拒绝闭源插件 package import 和相邻源码路径', () => {
    expect(
      analyzePublicOwnerSourceForPrivatePluginReferences(
        'packages/plugins/slides/src/example.ts',
        [
          "import '@plugin/supplystrata/shared';",
          "const sheetRoot = 'packages/plugins/sheet';",
        ].join('\n'),
      ),
    ).toEqual([
      {
        file: 'packages/plugins/slides/src/example.ts',
        reference: '@plugin/supplystrata',
      },
      {
        file: 'packages/plugins/slides/src/example.ts',
        reference: 'packages/plugins/sheet',
      },
    ]);
  });

  it('忽略构建产物，避免把 consumer 输出误判成源码依赖', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-public-owner-boundary-'));
    temporaryRoots.push(temporaryRoot);
    const distDirectory = path.join(temporaryRoot, 'packages/renderer-ui/dist');
    fs.mkdirSync(distDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(distDirectory, 'index.js'),
      "import '@plugin/supplystrata/shared';\n",
      'utf8',
    );

    expect(runPublicPackagePrivatePluginBoundaryGuard(temporaryRoot)).toEqual([]);
  });

  it('拒绝已迁移的 Host metadata 切片重新依赖闭源插件源码', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-host-metadata-boundary-'));
    temporaryRoots.push(temporaryRoot);
    const relativePath = 'src/app-hosts/linnya/plugin-registry/builtin/index.ts';
    const absolutePath = path.join(temporaryRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, "import '@plugin/supplystrata/shared';\n", 'utf8');

    expect(runPublicPackagePrivatePluginBoundaryGuard(temporaryRoot)).toEqual([
      {
        file: relativePath,
        reference: '@plugin/supplystrata',
      },
    ]);
  });

  it('根测试与类型配置只允许尚未迁移的 Sheet，不允许 SupplyStrata 回流', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-root-config-boundary-'));
    temporaryRoots.push(temporaryRoot);
    fs.writeFileSync(
      path.join(temporaryRoot, 'tsconfig.json'),
      JSON.stringify({ sheet: 'packages/plugins/sheet', supply: '@plugin/supplystrata/shared' }),
      'utf8',
    );

    expect(runPublicPackagePrivatePluginBoundaryGuard(temporaryRoot)).toEqual([
      {
        file: 'tsconfig.json',
        reference: '@plugin/supplystrata',
      },
    ]);
  });

  it('Renderer profile 不允许重新登记任何私有插件源码', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-profile-boundary-'));
    temporaryRoots.push(temporaryRoot);
    const relativePath = 'vitest.renderer.config.ts';
    fs.writeFileSync(
      path.join(temporaryRoot, relativePath),
      "const privateEntries = ['packages/plugins/sheet', '@plugin/supplystrata/renderer'];\n",
      'utf8',
    );

    expect(runPublicPackagePrivatePluginBoundaryGuard(temporaryRoot)).toEqual([
      {
        file: relativePath,
        reference: '@plugin/supplystrata',
      },
      {
        file: relativePath,
        reference: 'packages/plugins/sheet',
      },
    ]);
  });
});
