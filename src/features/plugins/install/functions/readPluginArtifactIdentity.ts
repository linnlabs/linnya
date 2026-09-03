import fs from 'node:fs';
import path from 'node:path';

const artifactChecksumFileName = 'SHA512SUMS';

/**
 * 版本目录是不可变 artifact。运行时只比较打包阶段生成并验证过的 checksum
 * 清单，不在每次启动时重新散列大型插件的全部文件。
 */
export function readPluginArtifactIdentity(pluginDirectory: string): string {
  const checksumPath = path.join(pluginDirectory, artifactChecksumFileName);
  const stat = fs.statSync(checksumPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`插件 artifact 缺少 ${artifactChecksumFileName}: ${pluginDirectory}`);
  }

  const identity = fs.readFileSync(checksumPath, 'utf8').trim();
  if (!identity) {
    throw new Error(`插件 artifact ${artifactChecksumFileName} 不能为空: ${pluginDirectory}`);
  }
  return identity;
}
