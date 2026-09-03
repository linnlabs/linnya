import type { PresentationDraftRepositoryPort, PresentationRepositoryPort } from '../persistence';
import {
  createPresentationBuildFailure,
  PresentationBuildFailureError,
  type PresentationBuildFailure,
} from '../features/presentationBuildFailure';
import type {
  CodegenInitialDraftCreatorPort,
  CodegenPresentationBuilderPort,
} from './CodegenPresentationTypes';
import { createBlankPresentationSource } from './createBlankPresentationSource';

export interface InitialPresentationDraftCreatorDeps {
  readonly builder: CodegenPresentationBuilderPort;
  readonly presentationRepo: Pick<PresentationRepositoryPort, 'getPresentation'>;
  readonly draftRepo: PresentationDraftRepositoryPort;
  readonly deletePresentationNode: (nodeId: string) => Promise<void>;
  readonly discardPresentationShell: (nodeId: string) => Promise<void>;
}

/**
 * 首次编译失败的原子补偿编排：先建立有效基线，再保存真实源码 draft。
 * 任一步失败都会删除刚创建的 Workspace 节点，避免留下看似成功的空白文稿。
 */
export class InitialPresentationDraftCreator implements CodegenInitialDraftCreatorPort {
  constructor(private readonly deps: InitialPresentationDraftCreatorDeps) {}

  async create(input: Parameters<CodegenInitialDraftCreatorPort['create']>[0]) {
    const shell = await this.deps.builder.buildNewPresentation({
      source: createBlankPresentationSource(input.title),
      projectId: input.projectId,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.authorId ? { authorId: input.authorId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });

    try {
      const baseDocument = await this.deps.presentationRepo.getPresentation(shell.nodeId);
      if (!baseDocument) {
        throw buildFailure(
          'slides.persistence.commit_failed',
          'The presentation shell could not be read after it was committed.'
        );
      }
      const draft = this.deps.draftRepo.upsert(
        shell.nodeId,
        input.source,
        baseDocument,
        input.failure.summary,
        input.failure.code
      );
      return { shell, draft };
    } catch (error) {
      return this.rollbackCreatedShell(shell.nodeId, error);
    }
  }

  private async rollbackCreatedShell(nodeId: string, originalError: unknown): Promise<never> {
    try {
      await this.deps.deletePresentationNode(nodeId);
    } catch {
      throw buildFailure(
        'slides.environment.workspace_unavailable',
        'The failed presentation draft could not be rolled back from Workspace.'
      );
    }

    try {
      await this.deps.discardPresentationShell(nodeId);
    } catch {
      throw buildFailure(
        'slides.persistence.commit_failed',
        'The failed presentation shell could not be removed from Slides persistence.'
      );
    }

    if (originalError instanceof PresentationBuildFailureError) {
      throw originalError;
    }
    throw buildFailure(
      'slides.persistence.draft_failed',
      'The initial deck.js source could not be saved as a presentation draft.'
    );
  }
}

function buildFailure(
  code: Parameters<typeof createPresentationBuildFailure>[0]['code'],
  summary: string
): PresentationBuildFailureError {
  return new PresentationBuildFailureError(createPresentationBuildFailure({ code, summary }));
}

export function canCreateInitialDraftForFailure(failure: PresentationBuildFailure): boolean {
  return (
    failure.phase === 'typecheck' ||
    failure.phase === 'sandbox' ||
    failure.phase === 'compose' ||
    failure.phase === 'source_contract' ||
    failure.phase === 'asset' ||
    failure.phase === 'materialization'
  );
}
