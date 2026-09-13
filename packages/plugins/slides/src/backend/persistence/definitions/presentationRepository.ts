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

interface PresentationCommitBaseOptions {
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
  /** 人工编辑只提交语义 revision；artifact 在导出或旧 PPTX inspect 时按需物化。 */
  readonly revisionContext?: 'inherit_base';
}

export type PresentationCommitOptions = PresentationCommitBaseOptions & (
  | { readonly pptxBuffer: Buffer; readonly deferPptx?: never }
  | { readonly deferPptx: true; readonly pptxBuffer?: never }
);

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
  readonly pptxArtifact: PresentationCurrentPptxArtifact;
  readonly title: string;
  readonly slideCount: number;
  readonly layout?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly authorId?: string;
}

export type PresentationCurrentPptxArtifact =
  | { readonly state: 'ready'; readonly revisionId: string; readonly buffer: Buffer }
  | { readonly state: 'deferred' };

/** 按需物化 PPTX 所需的 revision 快照；只会返回与 current revision 精确匹配的 bytes。 */
export interface PresentationPptxArtifactSourceRecord extends PresentationRenderSourceRecord {
  readonly artifact: PresentationCurrentPptxArtifact;
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

/** generated RenderModel 的最小持久化事实；deckSource 只用于旧稿 source-span 恢复。 */
export interface PresentationRenderSourceRecord {
  readonly nodeId: string;
  readonly currentRevisionId: string;
  readonly currentRevision: number;
  readonly deckSource: string;
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

/** current 文稿读模型的窄查询端口；query runtime 不依赖 mutation/history/template 能力。 */
export interface PresentationDocumentQueryPort {
  getPresentation(nodeId: string): Promise<PresentationDocumentRecord | null>;
  getPresentationIdentity(nodeId: string): Promise<PresentationDocumentIdentity | null>;
  getPresentationPreviewSource(nodeId: string): Promise<PresentationPreviewSourceRecord | null>;
  getPresentationRenderSource(nodeId: string): Promise<PresentationRenderSourceRecord | null>;
  getPresentationPptxArtifactSource(
    nodeId: string,
  ): Promise<PresentationPptxArtifactSourceRecord | null>;
}

export interface PresentationRepositoryPort extends PresentationDocumentQueryPort {
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
  /** 仅当目标仍是 current revision 时附着 artifact；不会产生新的语义 revision。 */
  savePresentationPptxArtifact(
    nodeId: string,
    revisionId: string,
    pptxBuffer: Buffer,
  ): Promise<boolean>;
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
