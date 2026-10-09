/** 模型可见的业务交接；持久回执、版本 hash 和阶段状态由 Host 单独管理。 */
export type ResearchStageRequestKind =
  | 'investigation'
  | 'investigation_review'
  | 'draft'
  | 'argument_review'
  | 'source_review'
  | 'revision';

export interface ResearchStageArtifactReference {
  readonly locator: string;
  /** Host 提供的人可读版本标识，模型不得据此制造 hash 或自行选新版。 */
  readonly version: string;
  readonly purpose: string;
}

export interface ResearchStageOutput {
  readonly locator: string;
  readonly purpose: string;
}

export interface ResearchStageRequestContext {
  readonly question: string;
  readonly reader: string;
  readonly materialBoundary: string;
  readonly timeRange?: string;
  readonly fixedDocumentLocators: readonly string[];
  readonly previousArtifacts: readonly ResearchStageArtifactReference[];
  readonly unresolvedQuestions: readonly string[];
  /** 具体需处理的问题，完整评审仍通过 previousArtifacts 的正式文档读取。 */
  readonly feedback: readonly string[];
  readonly output: ResearchStageOutput;
  readonly businessAnalysisNeeded: boolean;
  readonly deliverableRequirements?: string;
}

/** 固定材料编辑在类型上不允许启用外部检索。 */
export type ResearchStageRequestInput = ResearchStageRequestContext & {
  readonly stage: ResearchStageRequestKind;
} & (
  | { readonly taskType: 'fixed'; readonly allowRetrieval: false }
  | { readonly taskType: 'open' | 'update'; readonly allowRetrieval: boolean }
);

export type ResearchMethodResource =
  | 'references/modeling.md'
  | 'references/article-craft.md'
  | 'references/business-analysis.md';

export interface PreparedResearchStageRequest {
  readonly promptKey: string;
  readonly query: string;
  readonly methodVersion: 'research-feedback-v1';
  readonly requiredResources: readonly ResearchMethodResource[];
}
