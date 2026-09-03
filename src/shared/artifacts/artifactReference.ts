const WORKSPACE_VFS_INODE_PATTERN = /^workspace:[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Workspace inode 是 VFS 节点的稳定身份，不是 resource URI。
 * 单独定义该合同，避免 TaskState 和 benchmark 再依赖 resource_read 的路由协议。
 */
export function isWorkspaceVfsInode(value: string): boolean {
  return WORKSPACE_VFS_INODE_PATTERN.test(value.trim());
}
