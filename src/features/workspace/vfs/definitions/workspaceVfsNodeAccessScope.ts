/** Host 为本次操作物化的真实 Workspace 节点拒绝集；不包含路径或业务阶段。 */
export interface WorkspaceVfsNodeAccessScope {
  readonly excludedNodeIds: readonly string[];
}

/** 与路径缺失分开，避免调用方把拒绝访问解释成可新建文件。 */
export class WorkspaceVfsNodeAccessDeniedError extends Error {
  readonly code = 'EPERM';

  constructor() {
    super('[WORKSPACE_NODE_ACCESS_DENIED] 当前调用无权访问此 Workspace 节点。');
    this.name = 'WorkspaceVfsNodeAccessDeniedError';
  }
}
