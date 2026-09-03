import type {
  EditableTarget,
  PresentationRenderModel,
  RenderSourceSpan,
  SlideBackgroundModel,
} from './renderModel';
import type { SlideTextLayoutProvenance } from './textLayout';
import type { GradientPaint } from './visual/paint';
import type { GeneratedLayoutConstraintEvidence } from './generatedLayoutConstraints';
import type { SpatialAnalysisSummary } from './spatialTypes';
import type { PresentationToolCapabilityMap } from './toolCapabilities';

export type ToolCapabilityMap = PresentationToolCapabilityMap;

export interface ReferenceFrameInfo {
  id: string;
  box: {
    x: number;
    y: number;
    w: number;
    h: number;
    unit: 'in';
  };
}

export interface InspectPageSummary {
  slideNumber: number;
  layoutKey: string;
  elementCount: number;
  background: InspectBackgroundSummary;
  editableTargets: EditableTarget[];
  slideTools: string[];
  sourceLocation?: SourceLocationHint;
}

export interface SourceLocationHint {
  file: 'deck.js';
  slideNumber: number;
  startLine: number;
  endLine: number;
}

export interface InspectBackgroundSummary {
  color?: string;
  imageSrc?: string;
  gradient?: GradientPaint;
}

export interface SceneGraphNodeSummary {
  nodeId: string;
  slideNumber: number;
  kind: string;
  box: {
    x: number;
    y: number;
    w: number;
    h: number;
    unit: 'in';
  };
  localBox: {
    x: number;
    y: number;
    w: number;
    h: number;
    unit: 'in';
  };
  zIndex: number;
  sourceKind: PresentationRenderModel['sourceKind'];
  sourceSpan?: RenderSourceSpan;
  /** generated-only 的布局约束事实，供 backend finding admission 定位父容器。 */
  layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
  style?: Record<string, unknown>;
  content?: Record<string, unknown>;
  parentNodeId?: string;
  children: SceneGraphNodeSummary[];
  elementId?: string;
  creationId?: string;
  elementName?: string;
  semanticNodeId?: string;
  semanticRole?: string;
  capabilities: ToolCapabilityMap;
  referenceFrame: 'slide';
  diagnostics: string[];
}

export interface SceneGraphSlideSummary {
  slideNumber: number;
  referenceFrames: ReferenceFrameInfo[];
  rootNode: SceneGraphNodeSummary;
  /** Inspect 场景图使用的紧凑文本布局归因摘要。 */
  textLayoutProvenance?: SlideTextLayoutProvenance;
}

export interface ToolArtifactRef {
  presentationId: string;
  versionId: string;
  slideCount: number;
}

export interface ToolBuildStatus {
  /** Inspect 只在已取得同一版本的 RenderModel 后返回 ready。 */
  state: 'ready' | 'draft' | 'unavailable';
  /** draft / unavailable 时可携带稳定失败事实；不得放原始异常或绝对路径。 */
  code?: string;
  summary?: string;
  retryable?: boolean;
}

export interface ToolFeedbackPayload {
  artifact: ToolArtifactRef;
  pageSummaries: InspectPageSummary[];
  sceneGraph: SceneGraphSlideSummary[];
  spatialAnalysis: SpatialAnalysisSummary[];
  buildStatus: ToolBuildStatus;
}
