import type {
  PresentationInspectionRequest,
  PresentationSourceKind,
  SlidesDraftStatus,
  SlidesSourceOrigin,
  SlidesSourceSliceOutput,
  SlidesSourceSlicesInput,
  SlidesSourceSlicesOutput,
  SlidesSourceSliceTargetInput,
} from '@plugin/slides/shared';
import type { PresentationInspectionResult } from '../features/presentationInspection';
import type { ExportedPresentationFile } from '@plugin/slides/backend-engine-core';
import type {
  PptEditInput as CodegenPptEditInput,
  PptEditOutput as CodegenPptEditOutput,
  PptWriteInput as CodegenPptWriteInput,
  PptWriteOutput as CodegenPptWriteOutput,
  StructuredPatchHunk,
  StructuredPatchLine,
} from '@plugin/slides/backend-codegen';

export interface GeneratePresentationOptions {
  readonly projectId: string;
  readonly parentId?: string;
  readonly authorId?: string;
  readonly conversationId?: string;
}

export interface GeneratePresentationResult {
  readonly nodeId: string;
  readonly versionId: string;
}

export interface PresentationInspectTargetInput {
  readonly path?: string;
  readonly inode?: string;
}

export interface ResolvedPresentationInspectTarget {
  readonly presentationId: string;
  readonly path?: string;
  readonly inode?: string;
}

export type PresentationInspectTargetResolver = (
  input: PresentationInspectTargetInput,
) => Promise<ResolvedPresentationInspectTarget>;

export type SlidesStructuredPatchLine = StructuredPatchLine;

export type SlidesStructuredPatchHunk = StructuredPatchHunk;

export interface PptReadInput {
  readonly presentation_id: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly slide?: number;
}

export interface PptReadOutput {
  readonly type: 'text' | 'deck_unchanged';
  readonly file: {
    readonly presentationId: string;
    readonly title?: string;
    readonly versionId?: string;
    readonly content?: string;
    readonly numLines?: number;
    readonly startLine?: number;
    readonly totalLines?: number;
    readonly slide?: number;
    readonly sourceOrigin?: SlidesSourceOrigin;
    readonly sourceKey?: string;
    readonly draftStatus?: SlidesDraftStatus;
  };
}

export type PptSourceSliceTargetInput = SlidesSourceSliceTargetInput;

export type PptSourceSlicesInput = SlidesSourceSlicesInput;

export type PptSourceSliceOutput = SlidesSourceSliceOutput;

export type PptSourceSlicesOutput = SlidesSourceSlicesOutput;

export type PptEditInput = CodegenPptEditInput;

export type PptEditOutput = CodegenPptEditOutput;

export type PptWriteInput = CodegenPptWriteInput;

export type PptWriteOutput = CodegenPptWriteOutput;

export interface PptGrepInput {
  readonly presentation_id: string;
  readonly pattern: string;
  readonly slide?: number;
  readonly output_mode?: 'content' | 'files_with_matches' | 'count';
  readonly '-B'?: number;
  readonly '-A'?: number;
  readonly '-C'?: number;
  readonly context?: number;
  readonly '-n'?: boolean;
  readonly '-i'?: boolean;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly multiline?: boolean;
}

export interface PptGrepOutput {
  readonly presentationId: string;
  readonly title: string;
  readonly versionId: string;
  readonly sourceOrigin?: SlidesSourceOrigin;
  readonly sourceKey?: string;
  readonly draftStatus?: SlidesDraftStatus;
  readonly mode: 'content' | 'files_with_matches' | 'count';
  readonly content: string;
  readonly matchCount: number;
}

export interface PptStructureInput {
  readonly presentation_id: string;
}

export interface PptStructureOutput {
  readonly presentationId: string;
  readonly title: string;
  readonly versionId: string;
  readonly sourceOrigin?: SlidesSourceOrigin;
  readonly sourceKey?: string;
  readonly draftStatus?: SlidesDraftStatus;
  readonly totalLines: number;
  readonly slideCount: number;
  readonly slides: {
    readonly slideNumber: number;
    readonly startLine: number;
    readonly endLine: number;
    readonly titleGuess?: string;
    readonly elementCounts: Record<string, number>;
    readonly elementCountsUnavailable?: boolean;
  }[];
}

export interface CodegenToolContext {
  readonly conversationId: string;
}

export interface CodegenWriteContext extends CodegenToolContext {
  readonly projectId: string;
  readonly parentId?: string;
  readonly authorId?: string;
  readonly requestedTitle?: string;
}

export interface CodegenPresentationServicePort {
  read(input: PptReadInput, ctx: CodegenToolContext): Promise<PptReadOutput>;
  readSourceSlices(
    input: PptSourceSlicesInput,
    ctx: CodegenToolContext,
  ): Promise<PptSourceSlicesOutput>;
  edit(input: PptEditInput, ctx: CodegenToolContext): Promise<PptEditOutput>;
  write(input: PptWriteInput, ctx: CodegenWriteContext): Promise<PptWriteOutput>;
  grep(input: PptGrepInput): Promise<PptGrepOutput>;
  structure(input: PptStructureInput): Promise<PptStructureOutput>;
}

/**
 * Presentation tools 只依赖这个窄 coordinator port。它刻意不暴露
 * `PptCoordinator` / repository / workspace service 实现，避免工具迁包时把
 * host 旧 engine 一起拖进插件包。
 */
export interface PresentationToolCoordinatorPort {
  createEmptyPresentation(
    options: GeneratePresentationOptions & { readonly title?: string },
  ): Promise<GeneratePresentationResult>;
  inspectPresentation(
    request: PresentationInspectionRequest,
  ): Promise<PresentationInspectionResult>;
  export(nodeId: string): Promise<ExportedPresentationFile>;
  /** 查询演示文稿的来源类型（generated / imported / patched）。 */
  getSourceKind(nodeId: string): Promise<PresentationSourceKind>;
  /** deck.js source-level 工具共享能力。 */
  getCodegenPresentationService(): CodegenPresentationServicePort;
}
