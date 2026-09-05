import type {
  DeckSpec,
  SlidesSourceSliceTargetInput,
  SlidesSourceSlicesOutput,
} from '@plugin/slides/shared';
import type { SlidesEngineExecutionAdapter } from '@plugin/slides/backend-engine-core';
import { executeSandboxProfile } from '@plugin/backend/sandboxRuntime';
import {
  CodegenDeckBuilder,
  type CodegenDeckBuilderFailureLogger,
  type CodegenDeckBuildInput,
  type CodegenDeckBuildResult,
  type CodegenDeckCreateInput,
  type CodegenDeckCreateResult,
  CodegenPresentationService,
  createBlankPresentationSource,
  DeckReadStateRegistry,
  InitialPresentationDraftCreator,
} from '../codegen';
import type { PresentationRevisionScope } from '../features/presentationSourceHistory';
import type {
  GeneratePresentationOptions,
  GeneratePresentationResult,
  PresentationDraftRepositoryPort,
  PresentationRepositoryPort,
  WorkspacePresentationPort,
} from './types.js';
import type { PresentationSvgGraphicOwnerPort } from '../features/presentationSvgGraphicOwnership';
import type { PresentationBuildExecutionPort } from '../features/presentationBuildExecution';

export interface CodegenDeckBuilderPort {
  buildNewPresentation(input: CodegenDeckCreateInput): Promise<CodegenDeckCreateResult>;
  buildFromSource(input: CodegenDeckBuildInput): Promise<CodegenDeckBuildResult>;
  buildDeckSpecFromSource(input: CodegenDeckBuildInput): Promise<DeckSpec>;
}

export type CodegenDeckBuilderFactory = () => CodegenDeckBuilderPort;

export interface PresentationCodegenRuntimeDeps {
  readonly revisionScope?: PresentationRevisionScope;
  readonly presentationRepo: PresentationRepositoryPort;
  readonly workspaceService?: WorkspacePresentationPort;
  readonly draftRepo?: PresentationDraftRepositoryPort;
  readonly engine: SlidesEngineExecutionAdapter;
  readonly codegenDeckBuilderFactory?: CodegenDeckBuilderFactory;
  readonly failureLogger?: CodegenDeckBuilderFailureLogger;
  readonly svgGraphicOwner?: PresentationSvgGraphicOwnerPort;
  readonly buildExecution: PresentationBuildExecutionPort;
}

/**
 * deck.js/source-first 演示文稿运行时。
 *
 * 中文说明：这里集中 CodegenPresentationService、DeckReadStateRegistry 与
 * CodegenDeckBuilder 的 lazy 生命周期，避免 PptCoordinator 同时管理
 * 传统 mutation 与 source 编辑两套状态。
 */
export class PresentationCodegenRuntime {
  private readonly deckReadStateRegistry = new DeckReadStateRegistry();
  private codegenPresentationService?: CodegenPresentationService;
  private codegenDeckBuilder?: CodegenDeckBuilderPort;

  constructor(private readonly deps: PresentationCodegenRuntimeDeps) {}

  getPresentationService(): CodegenPresentationService {
    if (!this.codegenPresentationService) {
      const initialDraftCreator = this.createInitialDraftCreator();
      this.codegenPresentationService = new CodegenPresentationService({
        presentationRepo: this.deps.presentationRepo,
        builder: this.getDeckBuilder(),
        ...(this.deps.draftRepo ? { draftRepo: this.deps.draftRepo } : {}),
        ...(initialDraftCreator ? { initialDraftCreator } : {}),
        readStateRegistry: this.deckReadStateRegistry,
        buildExecution: this.deps.buildExecution,
      });
    }

    return this.codegenPresentationService;
  }

  getDeckBuilder(): CodegenDeckBuilderPort {
    if (!this.codegenDeckBuilder) {
      const builder = this.deps.codegenDeckBuilderFactory?.() ?? this.createCodegenDeckBuilder();
      const scope = this.deps.revisionScope;
      this.codegenDeckBuilder = scope ? {
        buildNewPresentation: input => scope.run(`create:${crypto.randomUUID()}`, () => builder.buildNewPresentation(input)),
        buildFromSource: input => scope.run(input.nodeId, () => builder.buildFromSource(input)),
        buildDeckSpecFromSource: input => scope.run(input.nodeId, () => builder.buildDeckSpecFromSource(input)),
      } : builder;
    }
    return this.codegenDeckBuilder;
  }

  async readSourceSlicesForAiEdit(input: {
    presentationId: string;
    conversationId: string;
    targets: SlidesSourceSliceTargetInput[];
  }): Promise<SlidesSourceSlicesOutput> {
    return this.getPresentationService().readSourceSlices(
      {
        presentation_id: input.presentationId,
        targets: input.targets,
      },
      { conversationId: input.conversationId },
    );
  }

  async createEmptyPresentation(
    options: GeneratePresentationOptions & { readonly title?: string },
  ): Promise<GeneratePresentationResult> {
    const title = options.title?.trim() || '未命名演示文稿';
    const source = createBlankPresentationSource(title);
    const result = await this.getDeckBuilder().buildNewPresentation({
      source,
      projectId: options.projectId,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.parentId ? { parentId: options.parentId } : {}),
      ...(options.authorId ? { authorId: options.authorId } : {}),
    });
    return { nodeId: result.nodeId, versionId: result.versionId };
  }

  private createCodegenDeckBuilder(): CodegenDeckBuilderPort {
    return new CodegenDeckBuilder({
      recordSourceTheme: theme => this.deps.revisionScope?.recordSourceTheme(theme),
      presentationRepo: this.deps.presentationRepo,
      engine: this.deps.engine,
      sandbox: {
        execute: (request) => executeSandboxProfile(request),
      },
      buildExecution: this.deps.buildExecution,
      ...(this.deps.workspaceService ? { workspaceService: this.deps.workspaceService } : {}),
      ...(this.deps.failureLogger ? { failureLogger: this.deps.failureLogger } : {}),
      ...(this.deps.svgGraphicOwner ? { svgGraphicOwner: this.deps.svgGraphicOwner } : {}),
    });
  }

  private createInitialDraftCreator(): InitialPresentationDraftCreator | undefined {
    const draftRepo = this.deps.draftRepo;
    const workspaceService = this.deps.workspaceService;
    const deletePresentationNode = workspaceService?.deletePresentationNode;
    const discardCreatedPresentation = this.deps.presentationRepo.discardCreatedPresentation;
    if (
      !draftRepo ||
      !workspaceService ||
      !deletePresentationNode ||
      !discardCreatedPresentation
    ) {
      return undefined;
    }

    return new InitialPresentationDraftCreator({
      builder: this.getDeckBuilder(),
      presentationRepo: this.deps.presentationRepo,
      draftRepo,
      deletePresentationNode: nodeId => deletePresentationNode.call(workspaceService, nodeId),
      discardPresentationShell: nodeId =>
        discardCreatedPresentation.call(this.deps.presentationRepo, nodeId),
    });
  }
}
