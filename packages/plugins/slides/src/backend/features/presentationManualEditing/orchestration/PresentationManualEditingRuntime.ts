import type {
  SlidesManualEditCommand,
  SlidesManualEditCommandResult,
} from '@plugin/slides/shared';
import type {
  CodegenDeckBuildInput,
  CodegenManualEditCommitResult,
  CodegenProjectedDeckBuildInput,
} from '../../../codegen/index.js';
import {
  PresentationDraftConflictError,
  PresentationManualEditCommandConflictError,
  PresentationStaleBaseError,
  PresentationStaleSourceError,
  type PresentationDraftRepositoryPort,
  type PresentationRepositoryPort,
} from '../../../persistence/index.js';
import { PresentationBuildFailureError } from '../../presentationBuildFailure/index.js';
import type { PresentationRevisionScope } from '../../presentationSourceHistory/index.js';
import { createManualEditPayloadDigest } from '../functions/createManualEditPayloadDigest.js';
import {
  projectManualTranslationToDeckSpec,
  SlidesManualEditDeckProjectionError,
  type ManualTranslationDeckProjection,
} from '../functions/projectManualTranslationToDeckSpec.js';
import {
  SlidesManualEditSourceError,
  writeManualEditsToDeckSource,
} from '../functions/writeManualEditsToDeckSource.js';

export interface PresentationManualEditingRuntimeDeps {
  readonly presentationRepo: Pick<
    PresentationRepositoryPort,
    'getPresentation' | 'getManualEditReceipt'
  >;
  readonly draftRepo?: Pick<PresentationDraftRepositoryPort, 'has'>;
  readonly builder: {
    commitManualEditFromSource(
      input: CodegenDeckBuildInput,
    ): Promise<CodegenManualEditCommitResult>;
    commitManualEditFromProjectedDeckSpec(
      input: CodegenProjectedDeckBuildInput,
    ): Promise<CodegenManualEditCommitResult>;
  };
  readonly revisionScope?: PresentationRevisionScope;
}

/** 人工编辑的唯一写入口：验证快照，选择可证明等价的计算路径，再由 repository 原子提交。 */
export class PresentationManualEditingRuntime {
  constructor(private readonly deps: PresentationManualEditingRuntimeDeps) {}

  submit(command: SlidesManualEditCommand): Promise<SlidesManualEditCommandResult> {
    const run = (): Promise<SlidesManualEditCommandResult> => this.submitInScope(command);
    return this.deps.revisionScope
      ? this.deps.revisionScope.run(command.documentId, run)
      : run();
  }

  private async submitInScope(
    command: SlidesManualEditCommand,
  ): Promise<SlidesManualEditCommandResult> {
    const payloadDigest = createManualEditPayloadDigest(command);
    const receipt = await this.deps.presentationRepo.getManualEditReceipt(command.commandId);
    if (receipt) {
      if (receipt.nodeId !== command.documentId || receipt.payloadDigest !== payloadDigest) {
        return this.conflict(command, 'command_reused');
      }
      return {
        status: 'committed',
        commandId: command.commandId,
        documentId: command.documentId,
        revisionId: receipt.revisionId,
        revision: receipt.revision,
      };
    }

    const current = await this.deps.presentationRepo.getPresentation(command.documentId);
    if (!current) {
      return this.validationFailure(command, 'document_not_found', '演示文稿不存在。');
    }
    if (
      current.currentRevisionId !== command.expectedBase.revisionId
      || current.currentRevision !== command.expectedBase.revision
      || current.sourceHash !== command.expectedBase.sourceHash
    ) {
      return this.conflict(command, 'stale_base');
    }
    if (this.deps.draftRepo?.has(command.documentId)) {
      return this.conflict(command, 'draft_present');
    }

    let source: string;
    let projection: ManualTranslationDeckProjection;
    try {
      source = writeManualEditsToDeckSource(current.deckSource, command.operation).source;
      projection = projectManualTranslationToDeckSpec(current.deckSpec, command.operation);
    } catch (error) {
      if (
        error instanceof SlidesManualEditSourceError
        || error instanceof SlidesManualEditDeckProjectionError
      ) {
        return this.validationFailure(command, error.code, error.message);
      }
      throw error;
    }

    try {
      const buildInput: CodegenDeckBuildInput = {
        nodeId: command.documentId,
        source,
        expectedBase: command.expectedBase,
        expectedDraftState: 'absent',
        manualEditReceipt: {
          commandId: command.commandId,
          payloadDigest,
        },
        origin: 'edit',
      };
      const result = projection.kind === 'projected'
        ? await this.deps.builder.commitManualEditFromProjectedDeckSpec({
            ...buildInput,
            deckSpec: projection.deckSpec,
          })
        : await this.deps.builder.commitManualEditFromSource(buildInput);
      return {
        status: 'committed',
        commandId: command.commandId,
        documentId: command.documentId,
        revisionId: result.versionId,
        revision: result.versionNumber,
      };
    } catch (error) {
      if (error instanceof PresentationStaleBaseError || error instanceof PresentationStaleSourceError) {
        return this.conflict(command, 'stale_base');
      }
      if (error instanceof PresentationDraftConflictError) {
        return this.conflict(command, 'draft_present');
      }
      if (error instanceof PresentationManualEditCommandConflictError) {
        return this.conflict(command, 'command_reused');
      }
      if (error instanceof PresentationBuildFailureError) {
        return {
          status: 'build_failed',
          commandId: command.commandId,
          documentId: command.documentId,
          code: error.failure.code,
          message: error.failure.summary,
          retryable: error.failure.retryable,
          ...(error.failure.referenceId ? { referenceId: error.failure.referenceId } : {}),
        };
      }
      throw error;
    }
  }

  private conflict(
    command: SlidesManualEditCommand,
    reason: 'stale_base' | 'draft_present' | 'command_reused',
  ): SlidesManualEditCommandResult {
    return {
      status: 'conflict',
      commandId: command.commandId,
      documentId: command.documentId,
      reason,
    };
  }

  private validationFailure(
    command: SlidesManualEditCommand,
    code: string,
    message: string,
  ): SlidesManualEditCommandResult {
    return {
      status: 'validation_failed',
      commandId: command.commandId,
      documentId: command.documentId,
      code,
      message,
    };
  }
}
