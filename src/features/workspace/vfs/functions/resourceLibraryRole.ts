/**
 * @file resourceLibraryRole.ts
 * @description 项目资源库节点的稳定角色标记。
 */

import { RESOURCE_LIBRARY_CANONICAL_NAME } from '../definitions/workspaceVfsResourceNames';

export const RESOURCE_LIBRARY_ROLE = 'resource_library';
export const RESOURCE_LIBRARY_DEFAULT_NAME = RESOURCE_LIBRARY_CANONICAL_NAME;

export function buildResourceLibraryTags(): string {
  return JSON.stringify({
    linnyaRole: RESOURCE_LIBRARY_ROLE,
    workspacePathLayer: { version: 1 },
  });
}

export function hasResourceLibraryRole(tags: string | null): boolean {
  if (!tags) return false;
  try {
    const parsed: unknown = JSON.parse(tags);
    return typeof parsed === 'object' && parsed !== null && 'linnyaRole' in parsed && parsed.linnyaRole === RESOURCE_LIBRARY_ROLE;
  } catch {
    return false;
  }
}

export function buildUniqueResourceLibraryName(existingNames: readonly string[]): string {
  if (!existingNames.includes(RESOURCE_LIBRARY_DEFAULT_NAME)) {
    return RESOURCE_LIBRARY_DEFAULT_NAME;
  }

  let index = 2;
  while (existingNames.includes(`${RESOURCE_LIBRARY_DEFAULT_NAME} ${index}`)) {
    index += 1;
  }
  return `${RESOURCE_LIBRARY_DEFAULT_NAME} ${index}`;
}
