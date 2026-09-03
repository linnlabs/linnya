import type { SlidesDraftStatus } from '@plugin/slides/shared';
import type {
  CodegenDiagnostic,
  PresentationWriteFailure,
} from '@plugin/slides/backend-codegen';

export interface SlidesDocumentHookReadFile {
  readonly presentationId: string;
  readonly title?: string;
  readonly versionId?: string;
  readonly content?: string;
  readonly numLines?: number;
  readonly startLine?: number;
  readonly totalLines?: number;
  readonly slide?: number;
  readonly sourceOrigin?: string;
  readonly sourceKey?: string;
  readonly draftStatus?: SlidesDraftStatus;
}

export interface SlidesDocumentHookReadOutput {
  readonly type: 'text' | 'deck_unchanged';
  readonly file: SlidesDocumentHookReadFile;
}

export interface SlidesDocumentHookWriteOutput {
  readonly presentationId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly buildStatus: 'ready' | 'draft';
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly draftStatus?: SlidesDraftStatus;
  readonly buildFailure?: PresentationWriteFailure;
}

export interface SlidesDocumentHookCreateEmptyOutput {
  readonly nodeId: string;
  readonly versionId: string;
}

export interface SlidesDocumentHookRuntime {
  createEmptyPresentation(input: {
    readonly projectId: string;
    readonly parentId?: string;
    readonly title: string;
  }): Promise<SlidesDocumentHookCreateEmptyOutput>;
  writeSource(
    input: {
      readonly presentationId?: string;
      readonly source: string;
      readonly expectedSourceKey?: string;
    },
    context: {
      readonly conversationId: string;
      readonly projectId: string;
      readonly parentId?: string;
      readonly requestedTitle?: string;
    }
  ): Promise<SlidesDocumentHookWriteOutput>;
  readSource(input: {
    readonly presentationId: string;
    readonly conversationId: string;
  }): Promise<SlidesDocumentHookReadOutput>;
  renameCreatedNodeToRequestedFileName(input: {
    readonly nodeId: string;
    readonly fileName: string;
  }): void;
}

export type SlidesDocumentHookRuntimeFactory = (context: unknown) => SlidesDocumentHookRuntime;
