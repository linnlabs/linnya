import type { CitationSourceType } from '@app/schemas';

/**
 * 节点状态推荐值（小写存储，UI 展示时映射为中文）。
 */
export const NodeStatusValues = {
  OPEN: 'open',
  VERIFIED: 'verified',
  REFUTED: 'refuted',
  CLOSED: 'closed',
} as const;

export type NodeStatusValue = (typeof NodeStatusValues)[keyof typeof NodeStatusValues];

/**
 * 置信度推荐值（小写存储）。
 */
export const ConfidenceValues = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type ConfidenceValue = (typeof ConfidenceValues)[keyof typeof ConfidenceValues];

/**
 * 节点打标信息（推理语义）。
 *
 * 中文说明：
 * - 存在于 Spine：`mindmap_versions.content_json` 中的 NodeObj；
 * - 用于状态呈现与可解释入口（Refuted 感叹号）；
 * - 可扩展：未来允许新增更多标签键（例如 blocked / risk_level / owner 等）。
 */
export interface NodeTagging {
  /**
   * 节点状态。
   * - 推荐值：open/verified/refuted/closed；
   * - 允许扩展：工具可写入未知值，UI 需有兜底呈现。
   */
  status?: string;

  /**
   * 置信度。
   * - 推荐值：high/medium/low；
   * - 允许 number：例如 0..1 或 0..100（当需要量化时）。
   */
  confidence?: string | number;

  /**
   * 扩展标签。
   * - key：稳定语义键（建议 snake_case）；
   * - value：原子值，避免嵌套对象造成协议复杂化。
   */
  labels?: Record<string, string | number | boolean>;
}

/**
 * MindMap 打标操作类型（Write 协议）。
 *
 * 中文说明：
 * - 用于 workspace_tag_mindmap 工具的输入参数；
 * - 每个操作都是确定性的、可审计的。
 */
export type MindMapTaggingOp =
  | {
      type: 'node.setStatus';
      nodeRef?: string;
      nodeId?: string;
      status: string;
      note?: string;
    }
  | {
      type: 'node.setConfidence';
      nodeRef?: string;
      nodeId?: string;
      confidence: string | number;
      note?: string;
    }
  | {
      type: 'node.setLabels';
      nodeRef?: string;
      nodeId?: string;
      labels: Record<string, string | number | boolean>;
      mode?: 'merge' | 'replace';
    }
  | {
      type: 'evidence.attach';
      nodeRef?: string;
      nodeId?: string;
      evidence: {
        sourceType: CitationSourceType;
        sourceId: string;
        ref?: string;
        title?: string;
        snippet?: string;
        url?: string;
        authors?: string[];
        date?: string;
        containerTitle?: string;
        note?: string;
        orderIndex?: number;
      };
    };

/**
 * workspace_tag_mindmap 工具返回的变更集。
 */
export interface MindMapTaggingChangeSet {
  statusChangedNodeIds: string[];
  confidenceChangedNodeIds: string[];
  labelsChangedNodeIds: string[];
  tidiedArrowIds?: string[];
  tidiedSummaryIds?: string[];
}

/**
 * workspace_tag_mindmap 工具返回的证据结果。
 */
export interface MindMapTaggingEvidenceResult {
  attached: Array<{ nodeId: string; evidenceId: string }>;
  failed: Array<{ nodeId: string; reason: string }>;
}

/**
 * workspace_tag_mindmap 工具返回的结构化数据。
 */
export interface WorkspaceTagMindMapResultData {
  documentId: string;
  baseVersionNumber: number;
  versionNumber: number;
  changedNodeIds: string[];
  changedNodeRefs?: string[];
  changeSet: MindMapTaggingChangeSet;
  evidence: MindMapTaggingEvidenceResult;
  warnings?: string[];
}
