import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { deriveReleaseArtifactNames } from '../functions/deriveArtifactNames';
import { readReleasePackageInfo } from '../functions/readPackageVersion';

export function buildUploadChecklist(rootDir: string): string {
  const packageInfo = readReleasePackageInfo(rootDir);
  const artifacts = deriveReleaseArtifactNames({
    productName: packageInfo.productName,
    version: packageInfo.version,
  });

  return [
    `版本: ${packageInfo.version}`,
    `更新源: ${packageInfo.publishUrl}`,
    '',
    'macOS 需要上传:',
    `- dist_build/dist_electron/${artifacts.macDmg}`,
    `- dist_build/dist_electron/${artifacts.macZip}`,
    `- dist_build/dist_electron/${artifacts.macZipBlockmap}`,
    `- dist_build/dist_electron/${artifacts.macLatestYml}`,
    `- dist_build/dist_electron/linnya-desktop-${packageInfo.version}.darwin-arm64.content-bom.json`,
    '',
    'Windows 需要上传:',
    `- dist_build/dist_electron/${artifacts.winInstaller}`,
    `- dist_build/dist_electron/${artifacts.winInstallerBlockmap}`,
    `- dist_build/dist_electron/${artifacts.winLatestYml}`,
    `- dist_build/dist_electron/linnya-desktop-${packageInfo.version}.win32-x64.content-bom.json`,
    '',
    '发布前建议检查:',
    `- ${packageInfo.publishUrl}/${artifacts.macLatestYml}`,
    `- ${packageInfo.publishUrl}/${artifacts.winLatestYml}`,
    `- ${packageInfo.publishUrl}/${artifacts.macZip}`,
    `- ${packageInfo.publishUrl}/${artifacts.macZipBlockmap}`,
    `- ${packageInfo.publishUrl}/${artifacts.winInstaller}`,
    `- ${packageInfo.publishUrl}/${artifacts.winInstallerBlockmap}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildUploadChecklist(path.resolve(process.cwd())));
}
