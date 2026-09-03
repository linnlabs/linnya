import { createHash } from 'node:crypto';

import {
  LINNKIT_PROJECTION_SCHEMA_VERSION,
  type LinnkitProjectionEntry,
  type LinnkitSourceProvenance,
} from '../definitions/linnkitProjection';

const EXCLUDED_DIRECTORY_PREFIXES = [
  'dist/',
  'node_modules/',
  'docs/archive/',
  'docs/framework/',
  'docs/release/',
  'docs/99-research-notes/',
] as const;

const EXCLUDED_EXACT_PATHS = new Set([
  '.npmrc.example',
  'docs/DEVELOPMENT_GUIDE.md',
]);

export function shouldExportLinnkitPath(projectedPath: string): boolean {
  if (EXCLUDED_EXACT_PATHS.has(projectedPath)) return false;
  if (EXCLUDED_DIRECTORY_PREFIXES.some(prefix => projectedPath.startsWith(prefix))) return false;
  if (projectedPath.split('/').includes('.DS_Store')) return false;
  if (/^src\/.+\/README\.md$/u.test(projectedPath)) return false;
  return true;
}

export function normalizeGitRepositoryIdentity(remote: string): string {
  const trimmed = remote.trim().replace(/\.git$/u, '');
  const sshMatch = /^git@github\.com:(.+)$/u.exec(trimmed);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = /^https:\/\/github\.com\/(.+)$/u.exec(trimmed);
  return httpsMatch ? httpsMatch[1] : trimmed;
}

export function calculateLinnkitProjectionSha256(
  entries: readonly LinnkitProjectionEntry[]
): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.mode);
    hash.update('\0');
    hash.update(entry.path);
    hash.update('\0');
    hash.update(createHash('sha256').update(entry.content).digest('hex'));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function createLinnkitSourceProvenance(input: {
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly entries: readonly LinnkitProjectionEntry[];
}): LinnkitSourceProvenance {
  return {
    schemaVersion: LINNKIT_PROJECTION_SCHEMA_VERSION,
    sourceRepository: normalizeGitRepositoryIdentity(input.sourceRepository),
    sourceCommit: input.sourceCommit,
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    projectedFileCount: input.entries.length,
    projectionSha256: calculateLinnkitProjectionSha256(input.entries),
  };
}
