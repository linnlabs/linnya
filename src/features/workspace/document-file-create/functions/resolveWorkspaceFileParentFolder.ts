import type { WorkspaceNode } from '../../definitions/workspaceNode';
import { splitNormalizedVfsPath } from '../../vfs';

export function readWritableWorkspaceParentSegments(parentPath: string): readonly string[] {
  const segments = splitNormalizedVfsPath(parentPath);
  // .linnya 是 VFS 只读系统视图，不能用缺失路径创建用户节点遮蔽它。
  if (segments[0] === '.linnya') {
    throw new Error('write_file 不能在虚拟系统目录下新建文件：/.linnya');
  }
  return segments;
}

/** 同名不可猜选；隐藏节点也不能被当成不存在后创建一个同名目录。 */
export function resolveWorkspaceFileParentFolder(params: {
  readonly children: readonly WorkspaceNode[];
  readonly name: string;
  readonly path: string;
  readonly isVisibleNode: (nodeId: string) => boolean;
}): WorkspaceNode | undefined {
  const matches = params.children.filter(node => node.name === params.name);
  if (matches.length > 1) throw new Error(`Workspace 目录路径不唯一：${params.path}`);
  const node = matches[0];
  if (node && (node.type !== 'folder' || !params.isVisibleNode(node.id))) {
    throw new Error(`write_file 只能在可写的 Workspace 文件夹下新建文件：${params.path}`);
  }
  return node;
}
