import {
  parseFileLocator,
  type WorkspaceFileLocator,
} from '@app/schemas';

/**
 * Workspace 五件套在模型边界使用 locator，VFS owner 内部仍使用 `/...` 路径。
 * 这一个窄 mapper 是两层之间唯一的降维点，禁止在各工具里自行切字符串。
 */
export function workspacePathFromLocator(locator: WorkspaceFileLocator): string {
  const parsed = parseFileLocator(locator);
  if (parsed.kind !== 'workspace') {
    throw new Error('[WORKSPACE_FILE_LOCATOR_SCHEME_MISMATCH] 该工具只接受 workspace: locator。');
  }
  return parsed.path;
}
