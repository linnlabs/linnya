import {
  requestSave,
  getActiveFileSession,
  type FileSessionDescriptor,
} from '@/domains/workspace/services/file-manager';
import {
  useWorkspaceProjectsStore,
  useWorkspaceTreeStore,
} from '@/domains/workspace/store';
import type { WorkspaceNode } from '@/domains/workspace/store/WorkspaceTreeStore';
import type {
  WorkspaceActiveDocumentSession,
  WorkspaceContextDocumentType,
  WorkspaceContextPort,
  WorkspaceDocumentSummary,
  WorkspaceProjectFileSummary,
  WorkspaceProjectSummary,
} from '@/shared/ports/workspaceContextPort';
import { getDocumentTypeByNodeType } from '@/app/plugins/registry';
import { resolveWorkspaceNodeDisplayName } from '@/domains/workspace/functions/resolveWorkspaceNodeDisplayName';

function mapSessionType(type: string): WorkspaceContextDocumentType {
  return type.trim() || 'unknown';
}

function mapNodeType(type: WorkspaceNode['type']): WorkspaceContextDocumentType {
  switch (type) {
    case 'document':
      return 'markdown';
    default:
      return String(type).trim() || 'unknown';
  }
}

function toActiveDocumentSession(session: FileSessionDescriptor | null): WorkspaceActiveDocumentSession | null {
  if (!session) return null;
  return {
    documentId: session.documentId,
    displayName: session.displayName,
    type: mapSessionType(session.type),
  };
}

function toDocumentSummary(node: WorkspaceNode | null): WorkspaceDocumentSummary | null {
  if (!node) return null;
  return {
    id: node.id,
    title: resolveWorkspaceNodeDisplayName(node, node.name),
    type: mapNodeType(node.type),
    projectId: node.projectId,
  };
}

function toProjectFileSummary(node: WorkspaceNode): WorkspaceProjectFileSummary | null {
  if (node.type !== 'document' && !getDocumentTypeByNodeType(node.type)) return null;
  return {
    id: node.id,
    name: resolveWorkspaceNodeDisplayName(node, node.name),
    type: node.type,
    parentId: node.parentId,
  };
}

export function createWorkspaceContext(): WorkspaceContextPort {
  return {
    getActiveDocumentSession() {
      return toActiveDocumentSession(getActiveFileSession());
    },

    findDocumentSummary(documentId) {
      if (!documentId) return null;
      const treeStore = useWorkspaceTreeStore();
      return toDocumentSummary(treeStore.findNodeById(documentId));
    },

    getCurrentProjectSummary(projectId) {
      const projectsStore = useWorkspaceProjectsStore();
      const project = projectId
        ? projectsStore.projects.find((item) => item.id === projectId) ?? null
        : projectsStore.activeProject;
      if (!project) return null;
      return {
        id: project.id,
        name: project.name,
        description: project.description ?? undefined,
      };
    },

    getProjectFileSummaries(projectId, options = {}) {
      if (!projectId) return [];
      const limit = options.limit ?? 10;
      const treeStore = useWorkspaceTreeStore();
      const summaries: WorkspaceProjectFileSummary[] = [];
      for (const node of treeStore.flatProjectTree) {
        if (node.projectId !== projectId) continue;
        const summary = toProjectFileSummary(node);
        if (!summary) continue;
        summaries.push(summary);
        if (summaries.length >= limit) break;
      }
      return summaries;
    },

    async requestSaveBeforeAiInvoke() {
      return await requestSave('ai-invoke');
    },
  };
}
