import type {
  SlidesDraftStatus,
  SlidesSourceOrigin,
  SlidesSourceSliceOutput,
  SlidesSourceSlicesInput,
  SlidesSourceSlicesOutput,
  SlidesSourceSliceTargetInput,
} from '@plugin/slides/shared';
import type { PresentationDraftRepositoryPort, PresentationRepositoryPort } from '../persistence';
import type { PresentationDraftRecord } from '../persistence';
import type {
  PresentationBuildFailure,
  PresentationWriteFailure,
} from '../features/presentationBuildFailure';
import type { StructuredPatchHunk } from './diff/formatPatch.js';
import type { DeckReadStateRegistry } from './DeckReadStateRegistry.js';
import type {
  CodegenDeckBuildResult,
  CodegenDeckCreateResult,
  CodegenDeckExpectedBase,
} from './CodegenDeckBuilder.js';
import type { CodegenDiagnostic } from './writeDiagnostics';
import type { PresentationTypecheckExecutionPort } from '../features/presentationBuildExecution';

export type CodegenSourceOrigin = SlidesSourceOrigin;

export type CodegenDraftStatus = SlidesDraftStatus;

export interface PptReadInput {
  presentation_id: string;
  offset?: number;
  limit?: number;
  slide?: number;
}

export interface PptReadOutput {
  type: 'text' | 'deck_unchanged';
  file: {
    presentationId: string;
    title?: string;
    versionId?: string;
    content?: string;
    numLines?: number;
    startLine?: number;
    totalLines?: number;
    slide?: number;
    sourceOrigin?: CodegenSourceOrigin;
    sourceKey?: string;
    draftStatus?: CodegenDraftStatus;
  };
}

export type PptSourceSliceTargetInput = SlidesSourceSliceTargetInput;

export type PptSourceSlicesInput = SlidesSourceSlicesInput;

export type PptSourceSliceOutput = SlidesSourceSliceOutput;

export type PptSourceSlicesOutput = SlidesSourceSlicesOutput;

export interface PptEditInput {
  presentation_id: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface PptEditOutput {
  presentationId: string;
  title: string;
  versionId: string;
  oldString: string;
  newString: string;
  originalSource: string;
  structuredPatch: StructuredPatchHunk[];
  replaceAll: boolean;
  slideCount: number;
  parseWarnings: string[];
  diagnostics: readonly CodegenDiagnostic[];
}

export interface PptWriteInput {
  presentation_id?: string;
  source: string;
  /** 内部 CAS receipt；不属于模型可见 edit_file 参数。 */
  expected_source_key?: string;
}

export type PptWriteOutput =
  | {
      type: 'create';
      buildStatus: 'ready' | 'draft';
      presentationId: string;
      title: string;
      versionId: string;
      versionNumber: number;
      source: string;
      slideCount: number;
      parseWarnings: string[];
      diagnostics: readonly CodegenDiagnostic[];
      draftStatus?: CodegenDraftStatus;
      buildFailure?: PresentationWriteFailure;
    }
  | {
      type: 'update';
      buildStatus: 'ready' | 'draft';
      presentationId: string;
      title: string;
      versionId: string;
      versionNumber: number;
      source: string;
      structuredPatch: StructuredPatchHunk[];
      originalSource: string;
      slideCount: number;
      parseWarnings: string[];
      diagnostics: readonly CodegenDiagnostic[];
      draftStatus?: CodegenDraftStatus;
      buildFailure?: PresentationWriteFailure;
    };

export interface PptGrepInput {
  presentation_id: string;
  pattern: string;
  slide?: number;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-B'?: number;
  '-A'?: number;
  '-C'?: number;
  context?: number;
  '-n'?: boolean;
  '-i'?: boolean;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
}

export interface PptGrepOutput {
  presentationId: string;
  title: string;
  versionId: string;
  sourceOrigin?: CodegenSourceOrigin;
  sourceKey?: string;
  draftStatus?: CodegenDraftStatus;
  mode: 'content' | 'files_with_matches' | 'count';
  content: string;
  matchCount: number;
}

export interface PptStructureInput {
  presentation_id: string;
}

export interface PptStructureOutput {
  presentationId: string;
  title: string;
  versionId: string;
  sourceOrigin?: CodegenSourceOrigin;
  sourceKey?: string;
  draftStatus?: CodegenDraftStatus;
  totalLines: number;
  slideCount: number;
  slides: Array<{
    slideNumber: number;
    startLine: number;
    endLine: number;
    titleGuess?: string;
    elementCounts: Record<string, number>;
    elementCountsUnavailable?: boolean;
  }>;
}

export interface CodegenPresentationBuilderPort {
  buildFromSource(input: {
    nodeId: string;
    source: string;
    conversationId?: string;
    expectedBase?: CodegenDeckExpectedBase;
  }): Promise<CodegenDeckBuildResult>;
  buildNewPresentation(input: {
    source: string;
    projectId: string;
    parentId?: string;
    authorId?: string;
    conversationId?: string;
  }): Promise<CodegenDeckCreateResult>;
}

export interface CodegenInitialDraftCreatorPort {
  create(input: {
    readonly source: string;
    readonly title: string;
    readonly failure: PresentationBuildFailure;
    readonly projectId: string;
    readonly parentId?: string;
    readonly authorId?: string;
    readonly conversationId?: string;
  }): Promise<{
    readonly shell: CodegenDeckCreateResult;
    readonly draft: PresentationDraftRecord;
  }>;
}

export interface CodegenPresentationServiceDeps {
  presentationRepo: Pick<PresentationRepositoryPort, 'getPresentation'>;
  builder: CodegenPresentationBuilderPort;
  draftRepo?: PresentationDraftRepositoryPort;
  initialDraftCreator?: CodegenInitialDraftCreatorPort;
  readStateRegistry?: DeckReadStateRegistry;
  buildExecution: PresentationTypecheckExecutionPort;
}

export interface CodegenToolContext {
  conversationId: string;
}

export interface CodegenWriteContext extends CodegenToolContext {
  projectId: string;
  parentId?: string;
  authorId?: string;
  /** 首次源码无法执行时，用于建立可见 presentation shell 的标题。 */
  requestedTitle?: string;
}
