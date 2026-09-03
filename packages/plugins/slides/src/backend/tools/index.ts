export type {
  CodegenPresentationServicePort,
  CodegenToolContext,
  CodegenWriteContext,
  GeneratePresentationOptions,
  GeneratePresentationResult,
  PptEditInput,
  PptEditOutput,
  PptGrepInput,
  PptGrepOutput,
  PptReadInput,
  PptReadOutput,
  PptSourceSliceOutput,
  PptSourceSliceTargetInput,
  PptSourceSlicesInput,
  PptSourceSlicesOutput,
  PptStructureInput,
  PptStructureOutput,
  PptWriteInput,
  PptWriteOutput,
  PresentationInspectTargetInput,
  PresentationInspectTargetResolver,
  SlidesStructuredPatchHunk,
  SlidesStructuredPatchLine,
  PresentationToolCoordinatorPort,
  ResolvedPresentationInspectTarget,
} from './types';
export {
  attachPresentationCoordinatorProviderToToolContext,
  attachPresentationCoordinatorToToolContext,
  attachPresentationInspectTargetResolverToToolContext,
  copyPresentationCoordinatorBindingToToolContext,
  readPresentationInspectTargetResolverFromToolContext,
  readPresentationCoordinatorFromToolContext,
} from './toolContextBinding';
export type {
  PresentationCoordinatorProvider,
  PresentationCoordinatorProviderFactory,
  PresentationInspectTargetResolverFactory,
} from './toolContextBinding';
export {
  getPresentationCoordinator,
  readOptionalBooleanArgStrict,
  readOptionalNonEmptyStringArgStrict,
  readOptionalNonNegativeIntegerArg,
  readOptionalNonNegativeIntegerArgStrict,
  readOptionalPositiveIntegerArg,
  readOptionalPositiveIntegerArgStrict,
  readRequiredStringArg,
  requireCodegenPresentationService,
  requireConversationId,
  requirePresentationInspectTargetResolver,
  requirePresentationCoordinator,
} from './toolSupport';
export {
  buildInspectObservation,
} from './inspectObservation';
export { buildSourceLocationMap } from '../features/presentationInspection';
export type {
  PptInspectObservationData,
} from './inspectObservation';
export {
  ALIGNMENT_ACTIONS,
  ARRANGEMENT_PLACEMENTS,
  buildNodeToolCapabilities,
  buildInspectPageSummaries,
  buildSceneGraph,
  buildSlideTools,
  buildToolFeedbackPayload,
  buildToolFeedbackPayloadAsync,
  ELEMENT_ACTIONS,
} from './inspectFeedback';
export {
  collectFindings,
  evaluateQualityAnalysis,
} from './inspectFeedback/diagnostics';
export type {
  BuildToolFeedbackPayloadOptions,
} from './inspectFeedback/feedbackPayload';
export type {
  InspectBackgroundSummary,
  InspectPageSummary,
  PresentationToolCapabilityMap,
  ReferenceFrameInfo,
  SceneGraphNodeSummary,
  SceneGraphSlideSummary,
  SourceLocationHint,
  ToolArtifactRef,
  ToolBuildStatus,
  ToolCapabilityMap,
  ToolFeedbackPayload,
  DiagnosticFinding,
  DiagnosticToolFeedbackPayload,
} from './inspectFeedback';
