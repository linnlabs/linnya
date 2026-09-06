import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi'

export type MindmapToolStatus = 'loading' | 'success' | 'error'

export interface MindmapCreatedNodePresentation {
  readonly parentNodeId: string
  readonly parentNodeRef?: string
  readonly nodeId: string
  readonly nodeRef?: string
  readonly topic: string
}

export interface MindmapCreateNodePresentationData {
  readonly kind: 'create-node'
  readonly documentId: string
  readonly createdCount: number
  readonly items: readonly MindmapCreatedNodePresentation[]
  readonly warnings: readonly string[]
}

export interface MindmapLifecyclePresentationData {
  readonly kind: 'lifecycle'
  readonly documentId: string
}

export type MindmapMutationPresentationData =
  | MindmapLifecyclePresentationData
  | MindmapCreateNodePresentationData

export type MindmapCreateNodeCardPresentation = ToolCardPresentation<MindmapMutationPresentationData>
