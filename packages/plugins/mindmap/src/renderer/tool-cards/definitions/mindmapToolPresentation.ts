import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';

export type MindmapToolStatus = 'loading' | 'success' | 'error';

export interface MindmapTagNodeUpdatePresentation {
  readonly status?: string;
  readonly confidence?: string | number;
  readonly kind?: string;
}

export interface MindmapTagNodeItemPresentation {
  readonly nodeId: string;
  readonly nodeRef?: string;
  readonly topic: string;
  readonly updates: MindmapTagNodeUpdatePresentation;
}

export interface MindmapTagNodePresentationData {
  readonly kind: 'tag-node';
  readonly documentId: string;
  readonly items: readonly MindmapTagNodeItemPresentation[];
  readonly warnings: readonly string[];
}

export interface MindmapAttachEvidenceItemPresentation {
  readonly nodeId: string;
  readonly nodeRef?: string;
  readonly topic?: string;
  readonly evidenceId?: string;
  readonly status: 'attached' | 'failed';
  readonly message?: string;
}

export interface MindmapAttachEvidencePresentationData {
  readonly kind: 'attach-evidence';
  readonly documentId: string;
  readonly items: readonly MindmapAttachEvidenceItemPresentation[];
  readonly warnings: readonly string[];
}

export interface MindmapCreatedNodePresentation {
  readonly parentNodeId: string;
  readonly parentNodeRef?: string;
  readonly nodeId: string;
  readonly nodeRef?: string;
  readonly topic: string;
}

export interface MindmapCreateNodePresentationData {
  readonly kind: 'create-node';
  readonly documentId: string;
  readonly createdCount: number;
  readonly items: readonly MindmapCreatedNodePresentation[];
  readonly warnings: readonly string[];
}

export interface MindmapLifecyclePresentationData {
  readonly kind: 'lifecycle';
  readonly documentId: string;
}

export type MindmapMutationPresentationData =
  | MindmapLifecyclePresentationData
  | MindmapTagNodePresentationData
  | MindmapAttachEvidencePresentationData
  | MindmapCreateNodePresentationData;

export interface MindmapSingleSubrunPresentationData {
  readonly description: string;
  readonly status: MindmapToolStatus;
  readonly subrunId?: string;
  readonly subagentType: 'mindmap';
}

export interface MindmapParallelSubrunItemPresentation {
  readonly subrunId: string;
  readonly presentation: ToolCardPresentation<MindmapSingleSubrunPresentationData>;
}

export interface MindmapParallelSubrunPresentationData {
  readonly kind: 'parallel-subruns';
  readonly items: readonly MindmapParallelSubrunItemPresentation[];
}
