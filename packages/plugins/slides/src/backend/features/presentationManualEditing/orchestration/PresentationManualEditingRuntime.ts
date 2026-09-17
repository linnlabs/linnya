import { prepareManualEditSourceOperation } from '../functions/prepareManualEditSourceOperation.js';
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
import type { PresentationManualEditTracePort } from '../definitions/presentationManualEditTrace.js';
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
  readonly trace?: PresentationManualEditTracePort;
}

/** 人工编辑的唯一写入口：验证快照，选择可证明等价的计算路径，再由 repository 原子提交。 */
export class PresentationManualEditingRuntime {
  constructor(private readonly deps: PresentationManualEditingRuntimeDeps) {}

  submit(command: SlidesManualEditCommand): Promise<SlidesManualEditCommandResult> {
    const run = async (): Promise<SlidesManualEditCommandResult> => {
      try {
        return await this.submitInScope(command);
      } catch (error) {
        this.recordTrace(command, 'request_rejected', { outcome: 'infrastructure_failed' });
        throw error;
      }
    };
    return this.deps.revisionScope
      ? this.deps.revisionScope.run(command.documentId, run)
      : run();
  }

  private async submitInScope(
    command: SlidesManualEditCommand,
  ): Promise<SlidesManualEditCommandResult> {
    this.recordTrace(command, 'request_received');
    const payloadDigest = createManualEditPayloadDigest(command);
    const receipt = await this.deps.presentationRepo.getManualEditReceipt(command.commandId);
    if (receipt) {
      if (receipt.nodeId !== command.documentId || receipt.payloadDigest !== payloadDigest) {
        return this.conflict(command, 'command_reused');
      }
      this.recordTrace(command, 'receipt_reused', {
        outcome: 'committed',
        revision: receipt.revision,
      });
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
    this.recordTrace(command, 'snapshot_validated');

    let source: string;
    let projection: ManualTranslationDeckProjection;
    try {
      const sourceOperation = prepareManualEditSourceOperation(current.deckSpec, command.operation);
      source = writeManualEditsToDeckSource(current.deckSource, sourceOperation).source;
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
    const path = projection.kind === 'projected' ? 'projected_translation' : 'full_compile';
    this.recordTrace(command, 'source_rewritten', { path });

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
      this.recordTrace(command, 'semantic_build_started', { path });
      const result = projection.kind === 'projected'
        ? await this.deps.builder.commitManualEditFromProjectedDeckSpec({
            ...buildInput,
            deckSpec: projection.deckSpec,
          })
        : await this.deps.builder.commitManualEditFromSource(buildInput);
      this.recordTrace(command, 'revision_committed', {
        path,
        outcome: 'committed',
        revision: result.versionNumber,
      });
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
        this.recordTrace(command, 'request_rejected', { path, outcome: 'build_failed' });
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
    this.recordTrace(command, 'request_rejected', { outcome: 'conflict' });
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
    this.recordTrace(command, 'request_rejected', { outcome: 'validation_failed' });
    return {
      status: 'validation_failed',
      commandId: command.commandId,
      documentId: command.documentId,
      code,
      message,
    };
  }

  private recordTrace(
    command: SlidesManualEditCommand,
    stage: Parameters<PresentationManualEditTracePort['record']>[0]['stage'],
    details: Omit<Parameters<PresentationManualEditTracePort['record']>[0],
      'commandId' | 'documentId' | 'stage'> = {},
  ): void {
    this.deps.trace?.record({
      commandId: command.commandId,
      documentId: command.documentId,
      stage,
      ...details,
    });
  }
}
