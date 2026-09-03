import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPECTED_NODE_PTY_VERSION,
  prepareNodePtyRuntime,
} = require('../prepare-node-pty-runtime.cjs');

const temporaryRoots = [];

function createThinMachO(architecture) {
  const cpuType = architecture === 'arm64' ? 0x0100000c : 0x01000007;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpuType, 4);
  return header;
}

async function createNodePtyProject() {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'linnya-node-pty-package-'));
  temporaryRoots.push(root);
  const nodePtyRoot = path.join(root, 'node_modules/node-pty');
  await Promise.all([
    fsp.mkdir(path.join(nodePtyRoot, 'lib'), { recursive: true }),
    fsp.mkdir(path.join(nodePtyRoot, 'src'), { recursive: true }),
    fsp.mkdir(path.join(nodePtyRoot, 'scripts'), { recursive: true }),
    fsp.mkdir(path.join(nodePtyRoot, 'prebuilds/darwin-arm64'), { recursive: true }),
    fsp.mkdir(path.join(nodePtyRoot, 'prebuilds/darwin-x64'), { recursive: true }),
    fsp.mkdir(path.join(nodePtyRoot, 'prebuilds/win32-x64'), { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      dependencies: { 'node-pty': EXPECTED_NODE_PTY_VERSION },
    })}\n`),
    fsp.writeFile(path.join(nodePtyRoot, 'package.json'), `${JSON.stringify({
      name: 'node-pty',
      version: EXPECTED_NODE_PTY_VERSION,
      license: 'MIT',
    })}\n`),
    fsp.writeFile(path.join(nodePtyRoot, 'LICENSE'), 'MIT license\n'),
    fsp.writeFile(path.join(nodePtyRoot, 'README.md'), 'not runtime\n'),
    fsp.writeFile(path.join(nodePtyRoot, 'lib/index.js'), 'module.exports = {}\n'),
    fsp.writeFile(path.join(nodePtyRoot, 'src/pty.cc'), 'not runtime\n'),
    fsp.writeFile(path.join(nodePtyRoot, 'scripts/install.js'), 'not runtime\n'),
    fsp.writeFile(
      path.join(nodePtyRoot, 'prebuilds/darwin-arm64/pty.node'),
      createThinMachO('arm64'),
      { mode: 0o644 },
    ),
    fsp.writeFile(
      path.join(nodePtyRoot, 'prebuilds/darwin-arm64/spawn-helper'),
      createThinMachO('arm64'),
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(nodePtyRoot, 'prebuilds/darwin-x64/pty.node'),
      createThinMachO('x64'),
      { mode: 0o644 },
    ),
    fsp.writeFile(
      path.join(nodePtyRoot, 'prebuilds/darwin-x64/spawn-helper'),
      createThinMachO('x64'),
      { mode: 0o755 },
    ),
    fsp.writeFile(path.join(nodePtyRoot, 'prebuilds/win32-x64/conpty.node'), 'windows'),
  ]);
  return { root, nodePtyRoot };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('node-pty production package preparation', () => {
  it('macOS 只保留目标架构、运行时 JavaScript、包身份和许可证', async () => {
    const fixture = await createNodePtyProject();

    prepareNodePtyRuntime({
      projectDirectory: fixture.root,
      platform: 'darwin',
      architecture: 'arm64',
    });

    expect((await fsp.readdir(fixture.nodePtyRoot)).sort()).toEqual([
      'LICENSE',
      'lib',
      'package.json',
      'prebuilds',
    ]);
    expect(await fsp.readdir(path.join(fixture.nodePtyRoot, 'prebuilds'))).toEqual([
      'darwin-arm64',
    ]);
    expect((await fsp.readdir(
      path.join(fixture.nodePtyRoot, 'prebuilds/darwin-arm64'),
    )).sort()).toEqual(['pty.node', 'spawn-helper']);
  });

  it('Windows 从临时发布清单和依赖树移除不会使用的 node-pty', async () => {
    const fixture = await createNodePtyProject();

    prepareNodePtyRuntime({
      projectDirectory: fixture.root,
      platform: 'win32',
      architecture: 'x64',
    });

    await expect(fsp.stat(fixture.nodePtyRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const packageJson = JSON.parse(await fsp.readFile(
      path.join(fixture.root, 'package.json'),
      'utf8',
    ));
    expect(packageJson.dependencies).toEqual({});
  });

  it('拒绝错误版本、优先级更高的本地 build 和不可执行 helper', async () => {
    const wrongVersion = await createNodePtyProject();
    await fsp.writeFile(path.join(wrongVersion.nodePtyRoot, 'package.json'), JSON.stringify({
      name: 'node-pty',
      version: '1.1.0',
      license: 'MIT',
    }));
    expect(() => prepareNodePtyRuntime({
      projectDirectory: wrongVersion.root,
      platform: 'darwin',
      architecture: 'arm64',
    })).toThrow('package identity mismatch');

    const localBuild = await createNodePtyProject();
    await fsp.mkdir(path.join(localBuild.nodePtyRoot, 'build/Release'), { recursive: true });
    expect(() => prepareNodePtyRuntime({
      projectDirectory: localBuild.root,
      platform: 'darwin',
      architecture: 'arm64',
    })).toThrow('build/Release is forbidden');

    const wrongPermission = await createNodePtyProject();
    await fsp.chmod(
      path.join(wrongPermission.nodePtyRoot, 'prebuilds/darwin-arm64/spawn-helper'),
      0o644,
    );
    expect(() => prepareNodePtyRuntime({
      projectDirectory: wrongPermission.root,
      platform: 'darwin',
      architecture: 'arm64',
    })).toThrow('spawn-helper must be executable');
  });
});
