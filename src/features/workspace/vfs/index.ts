export { invalidateWorkspaceVfsSearchIndexNodes } from './orchestration/invalidateWorkspaceVfsSearchIndexNodes';
export {
  readPersistedWorkspaceVfsNode,
  readWorkspaceNodeIdentityIncludingDeleted,
  type WorkspaceNodeIdentity,
} from './orchestration/listWorkspaceVfsNodes';
export { readWorkspaceVfsNode } from './orchestration/readWorkspaceVfsNode';
export { resolveWorkspaceVfsNode } from './orchestration/resolveWorkspaceVfsNode';
export { splitNormalizedVfsPath } from './functions/pathSegments';
export type { WorkspaceVfsReadResult } from './definitions/workspaceVfsRead';
