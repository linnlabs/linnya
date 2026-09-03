import type { WorkspaceNode } from '@/domains/workspace/store';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

export interface ProjectOverviewStat {
  label: string;
  value: number | string;
  hint: string;
}

export function collectProjectDocumentNodes(
  nodes: WorkspaceNode[],
  documentNodeTypes: ReadonlySet<string>,
): WorkspaceNode[] {
  const documents: WorkspaceNode[] = [];

  const visit = (items: WorkspaceNode[]) => {
    for (const item of items) {
      if (documentNodeTypes.has(item.type)) {
        documents.push(item);
      }

      if (item.children && item.children.length > 0) {
        visit(item.children);
      }
    }
  };

  visit(nodes);
  return documents;
}

export function countProjectFolders(nodes: WorkspaceNode[]): number {
  let count = 0;

  const visit = (items: WorkspaceNode[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        count += 1;
      }

      if (item.children && item.children.length > 0) {
        visit(item.children);
      }
    }
  };

  visit(nodes);
  return count;
}

export function buildProjectOverviewStats(params: {
  documentCount: number;
  folderCount: number;
  charCount: number | null;
  workspaceMessage: WorkspaceMessageResolver;
}): ProjectOverviewStat[] {
  return [
    {
      label: params.workspaceMessage('workspace.projectOverview.stats.pages'),
      value: params.documentCount,
      hint: params.workspaceMessage('workspace.projectOverview.stats.pagesHint'),
    },
    {
      label: params.workspaceMessage('workspace.projectOverview.stats.folders'),
      value: params.folderCount,
      hint: '',
    },
    {
      label: params.workspaceMessage('workspace.projectOverview.stats.characters'),
      value: params.charCount ?? '—',
      hint: params.charCount != null ? '' : params.workspaceMessage('workspace.projectOverview.loading'),
    },
  ];
}
