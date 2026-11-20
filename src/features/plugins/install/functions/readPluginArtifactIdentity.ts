import fs from 'node:fs';
import path from 'node:path';
import { hash } from 'node:crypto';
import { PluginOperationError } from '../definitions/pluginOperationError';

const artifactChecksumFileName = 'SHA512SUMS';

/**
 * 版本目录是不可变 artifact。运行时只比较打包阶段生成并验证过的 checksum
 * 清单，不在每次启动时重新散列大型插件的全部文件。
 */
export function readPluginArtifactIdentity(pluginDirectory: string): string {
  const checksumPath = path.join(pluginDirectory, artifactChecksumFileName);
  const stat = fs.statSync(checksumPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new PluginOperationError(
      'artifact-integrity',
      `插件 artifact 缺少 ${artifactChecksumFileName}: ${pluginDirectory}`
    );
  }

  const identity = fs.readFileSync(checksumPath, 'utf8').trim();
  if (!identity) {
    throw new PluginOperationError(
      'artifact-integrity',
      `插件 artifact ${artifactChecksumFileName} 不能为空: ${pluginDirectory}`
    );
  }
  return identity;
}

/** 显式安装前验证随包文件字节，不能把拷贝同一份清单当成完整性校验。 */
export function assertBundledPluginArtifactIntegrity(
  pluginDirectory: string,
  entryPaths: readonly string[]
): void {
  const covered = new Set<string>();
  for (const line of readPluginArtifactIdentity(pluginDirectory).split(/\r?\n/u)) {
    const entry = /^([a-f0-9]{128}) {2}(.+)$/u.exec(line);
    const relative = entry?.[2];
    if (
      !relative ||
      /[:\\]/u.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..') ||
      covered.has(relative)
    ) {
      throw new PluginOperationError('artifact-integrity', `插件 SHA512SUMS 条目无效: ${line}`);
    }
    try {
      const file = fs.readFileSync(path.join(pluginDirectory, relative));
      if (hash('sha512', file) !== entry[1]) {
        throw new PluginOperationError('artifact-integrity', `插件文件 SHA512 不一致: ${relative}`);
      }
    } catch (error) {
      if (error instanceof PluginOperationError) throw error;
      throw new PluginOperationError('artifact-integrity', `无法读取待校验插件文件: ${relative}`, {
        cause: error,
      });
    }
    covered.add(relative);
  }
  for (const relative of ['plugin.json', ...entryPaths.map(entry => entry.replace(/^\.\//u, ''))]) {
    if (!covered.has(relative)) {
      throw new PluginOperationError(
        'artifact-integrity',
        `插件 SHA512SUMS 缺少必需文件: ${relative}`
      );
    }
  }
}
