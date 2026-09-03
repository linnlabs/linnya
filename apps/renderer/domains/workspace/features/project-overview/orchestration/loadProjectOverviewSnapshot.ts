import type {
  IWorkspaceGateway,
  WorkspaceNodeDTO,
} from '@/shared/ipc/workspaceGateway';
import type { WorkspaceNode } from '@/domains/workspace/store';
import { createNodeFromData } from '@/domains/workspace/shared/workspaceTreeState';

type ProjectOverviewGateway = Pick<IWorkspaceGateway, 'list-vfs-nodes'>;

interface LoadProjectOverviewSnapshotParams {
  projectId: string;
  gateway: ProjectOverviewGateway;
}

function toWorkspaceNode(dto: WorkspaceNodeDTO, depth: number): WorkspaceNode {
  return createNodeFromData(dto, depth);
}

/**
 * 加载项目概览专用的只读文件树快照。
 *
 * 中文说明：项目概览可以从侧边栏直接打开，不能借用全局 WorkspaceTreeStore；
 * 否则查看 A 项目概览会污染当前正在编辑的 B 项目文件树。
 */
export async function loadProjectOverviewSnapshot(
  params: LoadProjectOverviewSnapshotParams,
): Promise<WorkspaceNode[]> {
  const visitedFolderIds = new Set<string>();

  async function loadChildren(parentId: string | null, depth: number): Promise<WorkspaceNode[]> {
    const result = await params.gateway['list-vfs-nodes']({
      projectId: params.projectId,
      parentId,
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    const nodes = result.data.map((dto) => toWorkspaceNode(dto, depth));

    await Promise.all(nodes.map(async (node) => {
      if (node.type !== 'folder') return;
      if (visitedFolderIds.has(node.id)) {
        node.children = [];
        return;
      }

      visitedFolderIds.add(node.id);
      node.children = await loadChildren(node.id, depth + 1);
    }));

    return nodes;
  }

  return loadChildren(null, 0);
}
