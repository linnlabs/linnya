import type { Component } from 'vue';
import type {
  ConversationReferenceCandidate,
  ConversationReferenceProviderContribution,
} from '@linnya/plugin-host-contract/renderer';
import type {
  OperationResult,
  RecentDocumentDTO,
} from '@/shared/ipc/workspaceGateway';
import type { WorkspaceNode } from '@/domains/workspace/store';
import { filterProjectTreeByName } from '@/domains/workspace/functions/filterProjectTreeByName';
import { resolveWorkspaceNodeDisplayName } from '@/domains/workspace/functions/resolveWorkspaceNodeDisplayName';

export const WORKSPACE_DOCUMENT_REFERENCE_PROVIDER_ID = 'workspace-document';
export const WORKSPACE_DOCUMENT_REFERENCE_KIND = 'workspace-document';

interface WorkspaceDocumentTypePresentation {
  readonly label: string;
  readonly icon: Component;
}

export interface WorkspaceDocumentReferenceProviderPorts {
  readonly getCurrentProjectId: () => string | null;
  readonly getLoadedProjectTree: () => {
    readonly projectId: string | null;
    readonly nodes: WorkspaceNode[];
  };
  readonly getRecentDocuments: (args: {
    readonly projectId: string;
    readonly limit: number;
  }) => Promise<OperationResult<RecentDocumentDTO[]>>;
  readonly resolveDocumentType: (nodeType: string) => WorkspaceDocumentTypePresentation | null;
}

interface WorkspaceDocumentCandidateSource {
  readonly id: string;
  readonly name: string;
  readonly nodeType: string;
  readonly projectId: string;
  readonly score: number;
}

interface WorkspaceDocumentReferenceCandidate extends ConversationReferenceCandidate {
  readonly projectId: string;
  readonly documentType: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scoreTreeCandidate(label: string, keyword: string): number {
  const normalizedLabel = normalizeSearchText(label);
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) return 0;
  if (normalizedLabel === normalizedKeyword) return 300;
  if (normalizedLabel.startsWith(normalizedKeyword)) return 200;
  if (normalizedLabel.includes(normalizedKeyword)) return 100;
  return 0;
}

function flattenDocumentNodes(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  const documents: WorkspaceNode[] = [];
  for (const node of nodes) {
    if (node.type !== 'folder') documents.push(node);
    if (node.children) documents.push(...flattenDocumentNodes(node.children));
  }
  return documents;
}

function toCandidate(
  source: WorkspaceDocumentCandidateSource,
  ports: WorkspaceDocumentReferenceProviderPorts,
): WorkspaceDocumentReferenceCandidate | null {
  const documentType = ports.resolveDocumentType(source.nodeType);
  if (!documentType) return null;
  return {
    id: source.id,
    label: source.name,
    description: documentType.label,
    icon: documentType.icon,
    projectId: source.projectId,
    documentType: source.nodeType,
    score: source.score,
  };
}

function createTreeCandidates(
  tree: WorkspaceNode[],
  projectId: string,
  keyword: string,
  ports: WorkspaceDocumentReferenceProviderPorts,
): ConversationReferenceCandidate[] {
  return flattenDocumentNodes(filterProjectTreeByName(tree, keyword))
    .map((node) => {
      const label = resolveWorkspaceNodeDisplayName(node, node.id);
      return toCandidate({
        id: node.id,
        name: label,
        nodeType: node.type,
        projectId,
        score: scoreTreeCandidate(label, keyword),
      }, ports);
    })
    .filter((candidate): candidate is WorkspaceDocumentReferenceCandidate => candidate !== null);
}

function createRecentCandidates(
  documents: readonly RecentDocumentDTO[],
  projectId: string,
  ports: WorkspaceDocumentReferenceProviderPorts,
): ConversationReferenceCandidate[] {
  return documents
    .map((document, index) => toCandidate({
      id: document.id,
      name: document.name,
      nodeType: document.type,
      projectId,
      score: 1_000 - index,
    }, ports))
    .filter((candidate): candidate is WorkspaceDocumentReferenceCandidate => candidate !== null);
}

function mergeCandidates(
  primary: readonly ConversationReferenceCandidate[],
  secondary: readonly ConversationReferenceCandidate[],
  limit: number,
): ConversationReferenceCandidate[] {
  const candidatesById = new Map<string, ConversationReferenceCandidate>();
  for (const candidate of [...primary, ...secondary]) {
    if (!candidatesById.has(candidate.id)) candidatesById.set(candidate.id, candidate);
  }
  return Array.from(candidatesById.values()).slice(0, limit);
}

function buildWorkspaceDocumentReferenceText(label: string, inode: string): string {
  return `Workspace document reference: "${label}" (inode="${inode}"). `
    + 'Use read_file with this inode and view="document" to read the latest content before answering.';
}

function readWorkspaceDocumentCandidate(
  candidate: ConversationReferenceCandidate,
): WorkspaceDocumentReferenceCandidate {
  if (
    'projectId' in candidate
    && typeof candidate.projectId === 'string'
    && 'documentType' in candidate
    && typeof candidate.documentType === 'string'
  ) {
    return {
      ...candidate,
      projectId: candidate.projectId,
      documentType: candidate.documentType,
    };
  }
  throw new Error('[workspaceDocumentReferenceProvider] 候选缺少 projectId/documentType');
}

export function createWorkspaceDocumentReferenceProvider(
  ports: WorkspaceDocumentReferenceProviderPorts,
): ConversationReferenceProviderContribution {
  return {
    pluginId: 'platform',
    id: WORKSPACE_DOCUMENT_REFERENCE_PROVIDER_ID,
    priority: 100,
    isAvailable: () => ports.getCurrentProjectId() !== null,
    query: async ({ keyword, limit = 20 }) => {
      const projectId = ports.getCurrentProjectId();
      if (!projectId) return [];

      const loadedTree = ports.getLoadedProjectTree();
      const treeCandidates = loadedTree.projectId === projectId
        ? createTreeCandidates(loadedTree.nodes, projectId, keyword, ports)
        : [];
      if (keyword.trim()) return treeCandidates.slice(0, limit);

      const recentResult = await ports.getRecentDocuments({ projectId, limit });
      if (!recentResult.success) {
        console.warn('[workspaceDocumentReferenceProvider] 最近文档读取失败', {
          projectId,
          error: recentResult.error,
        });
        return treeCandidates.slice(0, limit);
      }

      return mergeCandidates(
        createRecentCandidates(recentResult.data, projectId, ports),
        treeCandidates,
        limit,
      );
    },
    resolveReference: (candidate) => {
      const workspaceCandidate = readWorkspaceDocumentCandidate(candidate);
      if (ports.getCurrentProjectId() !== workspaceCandidate.projectId) {
        throw new Error('[workspaceDocumentReferenceProvider] 候选所属项目已切换');
      }
      const inode = `workspace:${workspaceCandidate.id}`;
      return {
        pluginId: 'platform',
        kind: WORKSPACE_DOCUMENT_REFERENCE_KIND,
        label: workspaceCandidate.label,
        previewText: workspaceCandidate.label,
        text: buildWorkspaceDocumentReferenceText(workspaceCandidate.label, inode),
        metadata: {
          documentId: workspaceCandidate.id,
          inode,
          projectId: workspaceCandidate.projectId,
          documentType: workspaceCandidate.documentType,
        },
      };
    },
  };
}
