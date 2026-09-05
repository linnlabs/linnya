import { DocumentHistoryError, planDocumentVersionRetention } from '@plugin/backend/documentHistory';
import type { DocumentVersionRestoreRequest, DocumentVersionSummary } from '@app/schemas';
import type { DeckSpec, PresentationRenderModel } from '@plugin/slides/shared';
import { PresentationStaleBaseError, type PresentationRepositoryPort } from '../../../persistence';
import { PresentationHistoryRepository } from '../infrastructure/PresentationHistoryRepository';
import { PresentationRevisionScope, type PresentationRevisionAsset } from './PresentationRevisionScope';
import { planPresentationSourceCompaction } from '../functions/planPresentationSourceCompaction';
import { reconstructPresentationSources } from '../functions/presentationSourceRevisionCodec';
import { PresentationSourceConsistencyError } from '../definitions/presentationSourceRevision';

export interface PresentationHistoryRuntimeDependencies {
  readonly history: PresentationHistoryRepository;
  readonly documents: PresentationRepositoryPort;
  readonly scope: PresentationRevisionScope;
  readonly compile: (input: { nodeId: string; source: string; themeJson?: string }) => Promise<DeckSpec>;
  readonly render: (documentId: string, version: DocumentVersionSummary, deck: DeckSpec) => Promise<PresentationRenderModel>;
  readonly assemble: (documentId: string, deck: DeckSpec) => Promise<Buffer>;
  readonly release: (documentId: string, assetIds: readonly string[]) => void;
  readonly reportFailure: (documentId: string, error: unknown) => void;
}

export class PresentationHistoryRuntime {
  private readonly maintenance = new Set<string>();
  constructor(private readonly deps: PresentationHistoryRuntimeDependencies) {}

  list(documentId: string): DocumentVersionSummary[] { return this.deps.history.list(documentId); }

  preview(documentId: string, versionId: string): Promise<PresentationRenderModel> {
    return this.deps.scope.run(documentId, async () => {
      const version = this.requireVersion(documentId, versionId);
      const deck = await this.compileVersion(documentId, version);
      return this.deps.render(documentId, version, deck);
    });
  }

  restore(request: DocumentVersionRestoreRequest): Promise<DocumentVersionSummary> {
    return this.deps.scope.run(request.documentId, async () => {
      const current = await this.deps.documents.getPresentation(request.documentId);
      if (!current) throw new DocumentHistoryError('document_not_found');
      if (current.currentRevisionId !== request.expectedCurrentVersionId) throw new DocumentHistoryError('version_conflict');
      const version = this.requireVersion(request.documentId, request.versionId);
      const source = await this.readSource(request.documentId, version.order);
      const deck = await this.deps.compile({ nodeId: request.documentId, source, ...this.deps.history.readContext(version.versionId) });
      const pptxBuffer = await this.deps.assemble(request.documentId, deck);
      try {
        const result = await this.deps.documents.commitPresentation(request.documentId, deck, {
          pptxBuffer, deckSource: source, baseRevisionId: current.currentRevisionId,
          baseRevision: current.currentRevision, origin: 'restore',
        });
        return this.requireVersion(request.documentId, result.revisionId);
      } catch (error) {
        if (error instanceof PresentationStaleBaseError) throw new DocumentHistoryError('version_conflict');
        throw error;
      }
    });
  }

  requestMaintenance(documentId: string): void {
    if (this.maintenance.has(documentId)) return;
    this.maintenance.add(documentId);
    void this.compact(documentId).catch(error => this.deps.reportFailure(documentId, error))
      .finally(() => this.maintenance.delete(documentId));
  }

  compact(documentId: string): Promise<void> {
    return this.deps.scope.run(documentId, async () => {
      const snapshot = this.deps.history.snapshot(documentId);
      if (snapshot.versions.length === 0) return;
      const keep = new Set(planDocumentVersionRetention(snapshot.versions).keepVersionIds);
      if (snapshot.draftBaseId) keep.add(snapshot.draftBaseId);
      const plan = planPresentationSourceCompaction(snapshot.sources, [...keep]);
      const backfill = new Map<string, { deck: DeckSpec; assets: readonly PresentationRevisionAsset[] }>();
      // 老版本只有源码：只读重建保留点，全部成功后才允许重链和释放资产。
      for (const { revision, source } of reconstructPresentationSources(plan.retained)) {
        if (this.deps.history.readContext(revision.revisionId)) continue;
        const deck = await this.deps.compile({ nodeId: documentId, source });
        const version = this.requireVersion(documentId, revision.revisionId);
        await this.deps.render(documentId, version, deck);
        backfill.set(revision.revisionId, { deck, assets: this.deps.scope.take(documentId) });
      }
      this.deps.history.compact(documentId, snapshot, plan, backfill);
      this.deps.history.releasePending(documentId, assets => this.deps.release(documentId, assets));
    });
  }

  private requireVersion(documentId: string, versionId: string): DocumentVersionSummary {
    const version = this.list(documentId).find(row => row.versionId === versionId);
    if (!version) throw new DocumentHistoryError('version_not_found');
    return version;
  }
  private async readSource(documentId: string, order: number): Promise<string> {
    try {
      const source = await this.deps.documents.getRevisionSource(documentId, order);
      if (source === null) throw new DocumentHistoryError('version_not_found');
      return source;
    } catch (error) {
      if (error instanceof PresentationSourceConsistencyError) throw new DocumentHistoryError('version_corrupt');
      throw error;
    }
  }
  private async compileVersion(documentId: string, version: DocumentVersionSummary): Promise<DeckSpec> {
    const source = await this.readSource(documentId, version.order);
    return this.deps.compile({ nodeId: documentId, source, ...this.deps.history.readContext(version.versionId) });
  }
}
