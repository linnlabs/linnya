/**
 * @file virtualNodeIds.ts
 * @description Workspace Path Layer 虚拟节点 ID 规则。
 */

const VFS_ID_PREFIX = 'vfs:workspace';

export function buildSystemRootFolderId(projectId: string): string {
  return `${VFS_ID_PREFIX}:${encodeURIComponent(projectId)}:system`;
}

export function buildSystemViewsFolderId(projectId: string): string {
  return `${buildSystemRootFolderId(projectId)}:views`;
}

export function buildSystemByInodeFolderId(projectId: string): string {
  return `${buildSystemViewsFolderId(projectId)}:by-inode`;
}

export function buildSystemProtocolFileId(projectId: string): string {
  return `${buildSystemRootFolderId(projectId)}:protocol`;
}

export function buildSystemInodeEntryFolderId(params: {
  projectId: string;
  workspaceNodeId: string;
}): string {
  return `${buildSystemByInodeFolderId(params.projectId)}:entry:${encodeURIComponent(params.workspaceNodeId)}`;
}

export function buildSystemInodeFileId(params: {
  projectId: string;
  workspaceNodeId: string;
  viewKind: string;
}): string {
  return `${buildSystemInodeEntryFolderId(params)}:file:${encodeURIComponent(params.viewKind)}`;
}

export function isSystemRootFolderId(projectId: string, nodeId: string): boolean {
  return nodeId === buildSystemRootFolderId(projectId);
}

export function isSystemViewsFolderId(projectId: string, nodeId: string): boolean {
  return nodeId === buildSystemViewsFolderId(projectId);
}

export function isSystemByInodeFolderId(projectId: string, nodeId: string): boolean {
  return nodeId === buildSystemByInodeFolderId(projectId);
}

export function tryParseSystemInodeEntryFolderId(projectId: string, nodeId: string): string | null {
  const prefix = `${buildSystemByInodeFolderId(projectId)}:entry:`;
  if (!nodeId.startsWith(prefix)) return null;
  return decodeURIComponent(nodeId.slice(prefix.length));
}
