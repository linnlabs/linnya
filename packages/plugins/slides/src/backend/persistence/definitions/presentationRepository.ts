import type { DeckSpec, TemplateSpec, TemplateSummary } from '@plugin/slides/shared';
import type { DocumentVersionSummary } from '@app/schemas';
import type { PresentationBuildFailureCode } from '../../features/presentationBuildFailure';
import type { PresentationRevisionStorageKind } from '../../features/presentationSourceHistory/index.js';

export type PresentationRevisionOrigin =
  | 'create'
  | 'codegen'
  | 'edit'
  | 'relayout'
  | 'repair'
  | 'restore';

export interface PresentationCreateOptions {
  readonly pptxBuffer: Buffer;
  readonly deckSource: string;
  readonly authorId?: string;
  readonly origin: 'create' | 'codegen';
}

export interface PresentationCommitOptions {
  readonly pptxBuffer: Buffer;
  readonly deckSource: string;
  readonly baseRevisionId: string;
  readonly baseRevision: number;
  readonly authorId?: string;
  readonly origin: Exclude<PresentationRevisionOrigin, 'create'>;
  readonly restoredFrom?: DocumentVersionSummary['restoredFrom'];
}

export interface PresentationCommitResult {
  readonly revisionId: string;
  readonly revision: number;
}

export interface PresentationDocumentRecord {
  readonly nodeId: string;
  readonly currentRevisionId: string;
  readonly currentRevision: number;
  readonly deckSource: string;
  readonly sourceHash: string;
  readonly deckSpec: DeckSpec;
  readonly pptxBuffer: Buffer;
  readonly title: string;
  readonly slideCount: number;
  readonly layout?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly authorId?: string;
}

export interface PresentationRevisionRecord {
  readonly revisionId: string;
  readonly nodeId: string;
  readonly revision: number;
  readonly parentRevisionId: string | null;
  readonly baseSourceHash: string | null;
  readonly sourceHash: string;
  readonly storageKind: PresentationRevisionStorageKind;
  readonly patchBytes: number;
  readonly createdAt: number;
  readonly authorId?: string;
  readonly origin: PresentationRevisionOrigin;
}

/** 历史值只用于读取旧 draft；新写入统一使用稳定的 Slides failure code。 */
export type PresentationDraftErrorKind =
  | PresentationBuildFailureCode
  | 'typecheck'
  | 'sandbox'
  | 'compose_parse'
  | 'assemble'
  | 'count_mismatch'
  | 'unknown';

export interface PresentationDraftRecord {
  readonly nodeId: string;
  readonly deckSource: string;
  readonly sourceHash: string;
  readonly baseRevisionId: string;
  readonly baseRevision: number;
  readonly lastErrorSummary?: string;
  readonly lastErrorKind?: PresentationDraftErrorKind;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class PresentationStaleBaseError extends Error {
  readonly code = 'PRESENTATION_STALE_BASE';

  constructor(
    readonly nodeId: string,
    readonly attemptedBaseRevisionId: string,
    readonly attemptedBaseRevision: number,
    readonly currentRevisionId: string | null,
    readonly currentRevision: number | null
  ) {
    super(
      `Presentation base is stale for ${nodeId}: attempted ${attemptedBaseRevisionId}/${attemptedBaseRevision}, current ${currentRevisionId ?? 'missing'}/${currentRevision ?? 'missing'}`
    );
    this.name = 'PresentationStaleBaseError';
  }
}

export class PresentationStaleSourceError extends Error {
  readonly code = 'PRESENTATION_STALE_SOURCE';

  constructor(
    readonly nodeId: string,
    readonly expectedSourceHash: string,
    readonly currentSourceHash: string
  ) {
    super(`Presentation source changed after it was read: ${nodeId}`);
    this.name = 'PresentationStaleSourceError';
  }
}

export class PresentationDraftStaleBaseError extends Error {
  readonly code = 'PRESENTATION_DRAFT_STALE_BASE';

  constructor(
    readonly nodeId: string,
    readonly attemptedBaseRevisionId: string,
    readonly attemptedBaseRevision: number,
    readonly currentRevisionId: string | null,
    readonly currentRevision: number | null
  ) {
    super(
      `Presentation draft base is stale for ${nodeId}: attempted ${attemptedBaseRevisionId}/${attemptedBaseRevision}, current ${currentRevisionId ?? 'missing'}/${currentRevision ?? 'missing'}`
    );
    this.name = 'PresentationDraftStaleBaseError';
  }
}

export interface PresentationDraftRepositoryPort {
  upsert(
    nodeId: string,
    source: string,
    baseDocument: PresentationDocumentRecord,
    errorSummary: string,
    errorKind: PresentationBuildFailureCode
  ): PresentationDraftRecord;
  get(nodeId: string): PresentationDraftRecord | null;
  has(nodeId: string): boolean;
  delete(nodeId: string): void;
}

export interface PresentationTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly spec: TemplateSpec;
  readonly sourcePptxBuffer: Buffer;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly usageCount: number;
}

export interface PresentationRepositoryPort {
  createPresentation(
    nodeId: string,
    deckSpec: DeckSpec,
    options: PresentationCreateOptions
  ): Promise<PresentationCommitResult>;
  commitPresentation(
    nodeId: string,
    deckSpec: DeckSpec,
    options: PresentationCommitOptions
  ): Promise<PresentationCommitResult>;
  getPresentation(nodeId: string): Promise<PresentationDocumentRecord | null>;
  /** 仅供创建流程失败后的补偿回滚；不能用于普通用户删除文稿。 */
  discardCreatedPresentation?(nodeId: string): Promise<void>;
  getRevisionSource(nodeId: string, revision: number): Promise<string | null>;
  listRevisions(nodeId: string): Promise<PresentationRevisionRecord[]>;
  saveTemplate(template: TemplateSpec, sourcePptxBuffer: Buffer): Promise<string>;
  getTemplate(templateId: string): Promise<PresentationTemplateRecord | null>;
  listTemplates(): Promise<TemplateSummary[]>;
  incrementTemplateUsage(templateId: string): Promise<void>;
}
