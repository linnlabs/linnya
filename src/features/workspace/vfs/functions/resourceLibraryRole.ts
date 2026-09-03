/**
 * @file resourceLibraryRole.ts
 * @description 项目资源库节点的稳定角色标记。
 */

import { RESOURCE_LIBRARY_CANONICAL_NAME } from '../definitions/workspaceVfsResourceNames';

export const RESOURCE_LIBRARY_ROLE = 'resource_library';
export const RESOURCE_LIBRARY_DEFAULT_NAME = RESOURCE_LIBRARY_CANONICAL_NAME;

interface ResourceLibraryTags {
  readonly linnyaRole?: string;
  readonly workspacePathLayer?: {
    readonly version?: number;
  };
}

export function buildResourceLibraryTags(): string {
  return JSON.stringify({
    linnyaRole: RESOURCE_LIBRARY_ROLE,
    workspacePathLayer: { version: 1 },
  });
}

export function hasResourceLibraryRole(tags: string | null): boolean {
  if (!tags) return false;
  try {
    const parsed = JSON.parse(tags) as ResourceLibraryTags;
    return parsed.linnyaRole === RESOURCE_LIBRARY_ROLE;
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
