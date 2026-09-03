/**
 * @file pathSegments.ts
 * @description Workspace Path Layer 路径规范化规则。
 */

export function normalizeVfsPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('VFS path is required.');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('VFS path must start with /.');
  }
  if (trimmed.includes('\\')) {
    throw new Error('VFS path must use / as separator.');
  }

  const rawSegments = trimmed.split('/');
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment) continue;
    if (segment === '.' || segment === '..') {
      throw new Error("VFS path cannot contain '.' or '..' segments.");
    }
    segments.push(segment);
  }

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function splitNormalizedVfsPath(pathValue: string): string[] {
  const normalized = normalizeVfsPath(pathValue);
  if (normalized === '/') return [];
  return normalized.slice(1).split('/');
}
