/** 只读节点路径投影；独立 CLI 不因此加载正文 reader、写入或异步索引流程。 */
export { readPersistedWorkspaceDocumentLocation } from './orchestration/readPersistedWorkspaceDocumentLocation';
export type { WorkspaceVfsStatement } from './definitions/workspaceVfsDatabase';

export { splitNormalizedVfsPath } from './functions/pathSegments';
