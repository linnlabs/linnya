import type { ReleaseArtifactNames } from '../definitions/releaseManifest';

export function deriveReleaseArtifactNames(input: {
  readonly productName: string;
  readonly version: string;
  readonly macArch?: 'arm64';
}): ReleaseArtifactNames {
  const macArch = input.macArch ?? 'arm64';

  return {
    macDmg: `${input.productName}-${input.version}-${macArch}.dmg`,
    macZip: `${input.productName}-${input.version}-${macArch}-mac.zip`,
    macZipBlockmap: `${input.productName}-${input.version}-${macArch}-mac.zip.blockmap`,
    macLatestYml: 'latest-mac.yml',
    winInstaller: `Linnya-${input.version}-win.exe`,
    winInstallerBlockmap: `Linnya-${input.version}-win.exe.blockmap`,
    winLatestYml: 'latest.yml',
  };
}
