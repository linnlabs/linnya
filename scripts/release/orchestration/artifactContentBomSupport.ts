import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
  ArtifactContentBom,
  ArtifactEnvelopeDescriptor,
  ArtifactSourceIdentity,
} from '../definitions/artifactContentBom';
import { sha256Hex, sha512Hex } from '../functions/artifactContentBom';

export function readArtifactSourceIdentity(rootDir: string): ArtifactSourceIdentity {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  return { revision, dirty: trackedChanges.length > 0 };
}

export function readArtifactEnvelope(
  filePath: string,
  role: ArtifactEnvelopeDescriptor['role']
): ArtifactEnvelopeDescriptor {
  const bytes = fs.readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    role,
    size: bytes.byteLength,
    sha256: sha256Hex(bytes),
    sha512: sha512Hex(bytes),
  };
}

export function writeOrVerifyArtifactContentBom(input: {
  readonly bom: ArtifactContentBom;
  readonly outputPath: string;
  readonly verify: boolean;
}): void {
  const serialized = `${JSON.stringify(input.bom, null, 2)}\n`;
  if (input.verify) {
    const current = fs.readFileSync(input.outputPath, 'utf8');
    if (current !== serialized) {
      throw new Error(`artifact content BOM 与当前产物不一致：${input.outputPath}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  fs.writeFileSync(input.outputPath, serialized, 'utf8');
}
