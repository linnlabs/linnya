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
  /** 人工编辑必须在最终提交事务确认没有绑定当前 base 的 draft。 */
  readonly expectedDraftState?: 'absent';
  /** 与 revision 同事务保存，供请求结果丢失后的幂等收口。 */
  readonly manualEditReceipt?: {
    readonly commandId: string;
    readonly payloadDigest: string;
  };
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

/** current revision 的轻量身份；状态查询不得为此读取源码、DeckSpec 或 PPTX bytes。 */
export interface PresentationDocumentIdentity {
  readonly nodeId: string;
  readonly currentRevisionId: string;
  readonly currentRevision: number;
  readonly sourceHash: string;
}

/** generated preview 的最小持久化事实；不包含源码与 PPTX bytes。 */
export interface PresentationPreviewSourceRecord {
  readonly nodeId: string;
  readonly currentRevisionId: string;
  readonly currentRevision: number;
  readonly deckSpec: DeckSpec;
  readonly title: string;
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

export interface PresentationManualEditReceiptRecord {
  readonly commandId: string;
  readonly nodeId: string;
  readonly payloadDigest: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly createdAt: number;
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

export class PresentationDraftConflictError extends Error {
  readonly code = 'PRESENTATION_DRAFT_CONFLICT';

  constructor(readonly nodeId: string) {
    super(`Presentation has an unresolved draft: ${nodeId}`);
    this.name = 'PresentationDraftConflictError';
  }
}

export class PresentationManualEditCommandConflictError extends Error {
  readonly code = 'PRESENTATION_MANUAL_EDIT_COMMAND_CONFLICT';

  constructor(readonly commandId: string) {
    super(`Presentation manual edit command was reused with different input: ${commandId}`);
    this.name = 'PresentationManualEditCommandConflictError';
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
  getPresentationIdentity(nodeId: string): Promise<PresentationDocumentIdentity | null>;
  getPresentationPreviewSource(nodeId: string): Promise<PresentationPreviewSourceRecord | null>;
  /** 仅供创建流程失败后的补偿回滚；不能用于普通用户删除文稿。 */
  discardCreatedPresentation?(nodeId: string): Promise<void>;
  getRevisionSource(nodeId: string, revision: number): Promise<string | null>;
  listRevisions(nodeId: string): Promise<PresentationRevisionRecord[]>;
  getManualEditReceipt(commandId: string): Promise<PresentationManualEditReceiptRecord | null>;
  saveTemplate(template: TemplateSpec, sourcePptxBuffer: Buffer): Promise<string>;
  getTemplate(templateId: string): Promise<PresentationTemplateRecord | null>;
  listTemplates(): Promise<TemplateSummary[]>;
  incrementTemplateUsage(templateId: string): Promise<void>;
}
