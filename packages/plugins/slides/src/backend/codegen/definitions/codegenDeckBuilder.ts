import type { DeckSpec } from '@plugin/slides/shared';
import type { SlidesEngineExecutionAdapter } from '@plugin/slides/backend-engine-core';
import type { SandboxExecutionRequest, SandboxExecutionResult } from '@plugin/backend/sandboxRuntime';
import type { PresentationCommitOptions, PresentationRepositoryPort } from '../../persistence/index.js';
import type { PresentationSvgGraphicOwnerPort } from '../../features/presentationSvgGraphicOwnership/index.js';
import type { PresentationComposeExecutionPort } from '../../features/presentationBuildExecution/index.js';
import type { CodegenDiagnostic } from '../writeDiagnostics/index.js';

export interface CodegenDeckCreateOptions {
  projectId: string;
  parentId?: string;
  authorId?: string;
  conversationId?: string;
}

export interface CodegenWorkspacePresentationPort {
  createPresentationNode?(options: CodegenDeckCreateOptions & { title: string }): Promise<string>;
  deletePresentationNode?(nodeId: string): Promise<void>;
  getPresentationProjectId?(nodeId: string): Promise<string | null>;
}

export interface CodegenDeckBuilderDeps {
  /** 记录实际注入源码的主题；输出 DeckSpec.theme 可能被这次源码修改，不能用来重放输入。 */
  recordSourceTheme?: (theme: DeckSpec['theme']) => void;
  presentationRepo: Pick<
    PresentationRepositoryPort,
    'createPresentation' | 'commitPresentation' | 'getPresentation'
  >;
  engine: Pick<SlidesEngineExecutionAdapter, 'assembleDeck'>;
  sandbox: CodegenSandboxExecutor;
  workspaceService?: CodegenWorkspacePresentationPort;
  failureLogger?: CodegenDeckBuilderFailureLogger;
  svgGraphicOwner?: PresentationSvgGraphicOwnerPort;
  buildExecution: PresentationComposeExecutionPort;
}

export interface CodegenDeckBuilderFailureLogger {
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface CodegenSandboxExecutor {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

export interface CodegenDeckBuildInput {
  nodeId: string;
  source: string;
  conversationId?: string;
  expectedBase?: CodegenDeckExpectedBase;
  expectedDraftState?: PresentationCommitOptions['expectedDraftState'];
  manualEditReceipt?: PresentationCommitOptions['manualEditReceipt'];
  origin?: 'codegen' | 'edit';
}

export interface CodegenDeckExpectedBase {
  readonly revisionId: string;
  readonly revision: number;
  readonly sourceHash: string;
}

export interface CodegenDeckCreateInput extends CodegenDeckCreateOptions {
  source: string;
}

export interface CodegenDeckBuildResult {
  versionId: string;
  versionNumber: number;
  deckSpec: DeckSpec;
  pptxBuffer: Buffer;
  diagnostics: readonly CodegenDiagnostic[];
  parseWarnings: string[];
}

export interface CodegenManualEditCommitResult {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly deckSpec: DeckSpec;
}

export interface CodegenProjectedDeckBuildResult extends CodegenManualEditCommitResult {
  readonly pptxBuffer: Buffer;
}

export interface CodegenProjectedDeckBuildInput extends CodegenDeckBuildInput {
  readonly deckSpec: DeckSpec;
}

export interface CodegenDeckCreateResult extends CodegenDeckBuildResult {
  nodeId: string;
}
