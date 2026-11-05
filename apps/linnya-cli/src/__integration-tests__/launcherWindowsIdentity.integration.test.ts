import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const launcher = readFileSync(new URL('../../bin/linnya.cjs', import.meta.url), 'utf8');

describe('Windows launcher source identity', () => {
  it('旧 bundle 的错误仍携带与原生路径解析一致的长目录身份', () => {
    const shortRoot = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\linnya-cli-bundle-test`;
    const nativeRoot = String.raw`C:\Users\runneradmin\AppData\Local\Temp\linnya-cli-bundle-test`;
    const cliRoot = path.win32.join(shortRoot, 'apps/linnya-cli');
    const artifact = Buffer.from('module.exports = {};');
    const manifest = JSON.stringify({
      schema_version: 1,
      source_sha256: 'before-source-edit',
      bundle_sha256: createHash('sha256').update(artifact).digest('hex'),
    });
    let stderr = '';
    let exitCode: number | undefined;
    const exited = new Error('launcher exited');

    // Mac 只模拟 Windows 文件系统边界；执行原始 CJS launcher 和真实哈希，不复制退出编排。
    expect(() => runInNewContext(launcher, {
      __dirname: path.win32.join(cliRoot, 'bin'),
      Buffer,
      require(id: string) {
        switch (id) {
          case 'node:crypto': return { createHash };
          case 'node:path': return path.win32;
          case 'node:child_process': return { spawnSync: () => ({ status: 0, stdout: 'main\n' }) };
          case 'node:fs': return {
            existsSync: () => true,
            readFileSync: (file: string) => file.endsWith('build.json') ? manifest : artifact,
            // 与 CI 实况一致：旧同步实现保留短名，原生实现给出长名。
            realpathSync: Object.assign(() => shortRoot, { native: () => nativeRoot }),
          };
          case '../build/sourceFingerprint.cjs': return {
            createCliSourceFingerprint: () => 'after-source-edit',
          };
          default: throw new Error(`Unverified bundle must not be loaded: ${id}`);
        }
      },
      process: {
        stderr: { write: (text: string) => { stderr += text; } },
        exit(code: number) { exitCode = code; throw exited; },
      },
    })).toThrow(exited);

    expect(exitCode).toBe(4);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: { code: 'protocol_incompatible', message: expect.stringContaining('bundle is stale') },
      connection: { source_root: nativeRoot, branch: 'main', state: 'not_connected', instance: null },
    });
  });
});
