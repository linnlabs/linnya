import { changeManualLayer } from '../functions/changeManualLayer.js';
import { moveSlideInDeckSource } from '../functions/moveSlideInDeckSource.js';
import { insertObjectsAtSlide } from '../functions/insertObjectsAtSlide.js';
import { ManualEditHistoryStore } from '../store/manualEditHistoryStore.js';
import {
  advanceManualEditHistory,
  manualEditHistoryFocus,
  manualEditHistoryStatus,
  manualEditHistoryTarget,
  reconcileManualEditHistory,
} from '../functions/manualEditHistory.js';
import { describeManualEditHistoryFocus } from '../functions/describeManualEditHistoryFocus.js';
import { relocateInsertedObjectSpans } from '../functions/relocateInsertedObjectSpans.js';
import type { ManualEditDeckProjection } from '../definitions/manualEditDeckProjection.js';
import { projectBlankSlideInsertion } from '../functions/projectBlankSlideInsertion.js';
import { rewriteSlideStructureInDeckSource } from '../functions/rewriteSlideStructureInDeckSource.js';
import { prepareManualEditBatch } from '../functions/prepareManualEditBatch.js';
import { prepareManualEditSourceOperation } from '../functions/prepareManualEditSourceOperation.js';
import type {
  DeckSpec,
  SlidesManualEditCommand,
  SlidesManualEditHistoryStatus,
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
import type {
  PresentationRevisionScope,
  PresentationHistoryRuntime,
} from '../../presentationSourceHistory/index.js';
import type { PresentationManualEditTracePort } from '../definitions/presentationManualEditTrace.js';
import { createManualEditPayloadDigest } from '../functions/createManualEditPayloadDigest.js';
import {
  projectManualEditToDeckSpec,
  SlidesManualEditDeckProjectionError,
} from '../functions/projectManualEditToDeckSpec.js';
import {
  SlidesManualEditSourceError,
  writeManualEditsToDeckSource,
  writeManualEditBatchToDeckSource,
} from '../functions/writeManualEditsToDeckSource.js';
import {
  insertBlankSlideIntoDeckSource,
  SlidesSlideInsertionSourceError,
} from '../functions/insertBlankSlideIntoDeckSource.js';
import { resolveInsertedSlideBackgroundColor } from '../functions/resolveInsertedSlideBackgroundColor.js';
import { anchorSystemAuthoringSource } from '../functions/anchorSystemAuthoringSource.js';
import { preserveAuthoringGeneration } from '../../../sandbox/authoringIdentity/index.js';

export interface PresentationManualEditingRuntimeDeps {
  readonly presentationRepo: Pick<
    PresentationRepositoryPort,
    'getPresentation' | 'getManualEditReceipt'
  >;
  readonly historyStore?: ManualEditHistoryStore;
  readonly restoreRevision?: PresentationHistoryRuntime['commitDeferredRestore'];
  readonly draftRepo: Pick<PresentationDraftRepositoryPort, 'has'>;
  readonly builder: {
    buildDeckSpecFromSource(input: CodegenDeckBuildInput): Promise<DeckSpec>;
    commitManualEditFromSource(
      input: CodegenDeckBuildInput
    ): Promise<CodegenManualEditCommitResult>;
    commitManualEditFromProjectedDeckSpec(
      input: CodegenProjectedDeckBuildInput
    ): Promise<CodegenManualEditCommitResult>;
  };
  readonly revisionScope: PresentationRevisionScope;
  readonly trace?: PresentationManualEditTracePort;
}

/** 人工编辑（对象值与页面结构）的唯一写入口：验证快照，选择可证明等价的计算路径，再由 repository 原子提交。 */
export class PresentationManualEditingRuntime {
  private readonly history: ManualEditHistoryStore;
  constructor(private readonly deps: PresentationManualEditingRuntimeDeps) {
    this.history = deps.historyStore ?? new ManualEditHistoryStore();
  }

  readHistoryStatus(documentId: string): Promise<SlidesManualEditHistoryStatus> {
    return this.deps.revisionScope.run(documentId, () => this.readHistoryStatusInScope(documentId));
  }

  private async readHistoryStatusInScope(
    documentId: string
  ): Promise<SlidesManualEditHistoryStatus> {
    const current = await this.deps.presentationRepo.getPresentation(documentId);
    if (!current) throw new Error('演示文稿不存在。');
    const state = reconcileManualEditHistory(
      this.history.read(documentId),
      current.currentRevisionId
    );
    this.history.write(documentId, state);
    return manualEditHistoryStatus(state);
  }

  submit(command: SlidesManualEditCommand): Promise<SlidesManualEditCommandResult> {
    this.recordTrace(command, 'request_received');
    const run = async (): Promise<SlidesManualEditCommandResult> => {
      this.recordTrace(command, 'scope_acquired');
      try {
        return await this.submitInScope(command);
      } catch (error) {
        this.recordTrace(command, 'request_rejected', { outcome: 'infrastructure_failed' });
        throw error;
      }
    };
    return this.deps.revisionScope.run(command.documentId, run);
  }

  private async submitInScope(
    command: SlidesManualEditCommand
  ): Promise<SlidesManualEditCommandResult> {
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
        history: await this.readHistoryStatusInScope(command.documentId),
      };
    }

    let current = await this.deps.presentationRepo.getPresentation(command.documentId);
    if (!current) {
      return this.validationFailure(command, 'document_not_found', '演示文稿不存在。');
    }
    if (
      current.currentRevisionId !== command.expectedBase.revisionId ||
      current.currentRevision !== command.expectedBase.revision ||
      current.sourceHash !== command.expectedBase.sourceHash
    ) {
      return this.conflict(command, 'stale_base');
    }
    if (this.deps.draftRepo.has(command.documentId)) {
      return this.conflict(command, 'draft_present');
    }
    if (current.deckSpec.authoringIdentityVersion !== 1) {
      current = { ...current, deckSpec: await this.deps.builder.buildDeckSpecFromSource({
        nodeId: command.documentId, source: current.deckSource, expectedBase: command.expectedBase,
        sourceContext: { theme: current.deckSpec.theme },
      }) };
    }
    current = { ...current, deckSource: anchorSystemAuthoringSource(current.deckSource, current.deckSpec) };
    this.recordTrace(command, 'snapshot_validated', {
      slideCount: current.deckSpec.slides.length,
      compiledRootCount: current.deckSpec.slides.reduce(
        (count, slide) => count + slide.spec.elements.length,
        0
      ),
    });
    const historyState = reconcileManualEditHistory(
      this.history.read(command.documentId),
      current.currentRevisionId
    );
    this.history.write(command.documentId, historyState);

    let source = current.deckSource;
    let projection: ManualEditDeckProjection = { kind: 'requires_full_compile' };
    let restoreVersion: string | undefined;
    try {
      switch (command.operation.op) {
        case 'undo':
        case 'redo': {
          restoreVersion = manualEditHistoryTarget(historyState, command.operation.op);
          if (!restoreVersion || !this.deps.restoreRevision)
            return this.validationFailure(command, 'history_empty', '当前没有可撤销或重做的编辑。');
          break;
        }
        case 'set_layer': {
          source = changeManualLayer(
            current.deckSource,
            current.deckSpec,
            command.operation.target,
            command.operation.direction
          );
          break;
        }
        case 'insert_objects': {
          source = insertObjectsAtSlide(
            current.deckSource,
            current.deckSpec.slides.length,
            command.operation.index,
            command.operation.objects
          );
          break;
        }
        case 'insert_blank_slide': {
          const backgroundColor = resolveInsertedSlideBackgroundColor(current.deckSpec.theme);
          const insertion = insertBlankSlideIntoDeckSource(current.deckSource, {
            index: command.operation.index,
            slideCount: current.deckSpec.slides.length,
            backgroundColor,
          });
          source = insertion.source;
          projection = projectBlankSlideInsertion(
            current.deckSpec,
            insertion,
            command.operation.index,
            backgroundColor
          );
          break;
        }
        case 'batch': {
          const operations = prepareManualEditBatch(current.deckSpec, command.operation.operations);
          const written = writeManualEditBatchToDeckSource(current.deckSource, operations);
          source = written.source;
          projection = { kind: 'projected', deckSpec: current.deckSpec };
          for (const operation of command.operation.operations) {
            if (projection.kind !== 'projected') break;
            projection = projectManualEditToDeckSpec(projection.deckSpec, operation);
          }
          projection = relocateProjectedInsertions(projection, written);
          break;
        }
        case 'move_slide': {
          source = moveSlideInDeckSource(
            current.deckSource,
            current.deckSpec.slides.length,
            command.operation.index,
            command.operation.toIndex
          );
          break;
        }
        case 'duplicate_slide':
        case 'delete_slide': {
          source = rewriteSlideStructureInDeckSource(current.deckSource, {
            ...command.operation,
            slideCount: current.deckSpec.slides.length,
          });
          projection = { kind: 'requires_full_compile' };
          break;
        }
        case 'set_text_width':
        case 'set_image':
        case 'set_text_content':
        case 'set_translation':
        case 'translate_by':
        case 'set_text_style':
        case 'set_fill_color':
        case 'set_visual_size':
        case 'delete_target': {
          const sourceOperation = prepareManualEditSourceOperation(
            current.deckSpec,
            command.operation
          );
          const written = writeManualEditsToDeckSource(current.deckSource, sourceOperation);
          source = written.source;
          projection = relocateProjectedInsertions(
            projectManualEditToDeckSpec(current.deckSpec, command.operation),
            written
          );
          break;
        }
        default: {
          const unsupported: never = command.operation;
          throw new Error(`Unsupported manual edit operation: ${JSON.stringify(unsupported)}`);
        }
      }
    } catch (error) {
      if (
        error instanceof SlidesManualEditSourceError ||
        error instanceof SlidesManualEditDeckProjectionError ||
        error instanceof SlidesSlideInsertionSourceError
      ) {
        return this.validationFailure(command, error.code, error.message);
      }
      throw error;
    }
    // 标记不改变生成程序摘要或现有 ref，因此排队中的后续操作无需猜测重绑。
    // 同一行插入注释也保留已有 sourceSpan 的行号和投影快路径。
    if (!restoreVersion) source = preserveAuthoringGeneration(current.deckSource, source);
    const path = restoreVersion
      ? 'history_restore'
      : projection.kind === 'projected'
        ? command.operation.op === 'insert_blank_slide'
          ? 'projected_slide_insertion'
          : 'projected_edit'
        : 'full_compile';
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
        onProgress: buildPhase => this.recordTrace(command, 'build_progress', { path, buildPhase }),
      };
      this.recordTrace(command, 'semantic_build_started', { path });
      const result =
        restoreVersion && this.deps.restoreRevision
          ? await this.deps.restoreRevision({
              documentId: command.documentId,
              versionId: restoreVersion,
              expectedBase: command.expectedBase,
              receipt: { commandId: command.commandId, payloadDigest },
            })
          : projection.kind === 'projected'
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
      const historyAction =
        command.operation.op === 'undo' || command.operation.op === 'redo'
          ? command.operation.op
          : 'edit';
      const focus =
        historyAction === 'edit' ? undefined : manualEditHistoryFocus(historyState, historyAction);
      const nextHistory = advanceManualEditHistory(
        historyState,
        result.versionId,
        historyAction,
        historyAction === 'edit'
          ? describeManualEditHistoryFocus(current.deckSpec, command.operation)
          : undefined
      );
      this.history.write(command.documentId, nextHistory);
      return {
        status: 'committed',
        commandId: command.commandId,
        documentId: command.documentId,
        revisionId: result.versionId,
        revision: result.versionNumber,
        history: manualEditHistoryStatus(nextHistory),
        ...(focus ? { focus } : {}),
      };
    } catch (error) {
      if (
        error instanceof PresentationStaleBaseError ||
        error instanceof PresentationStaleSourceError
      ) {
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
    reason: 'stale_base' | 'draft_present' | 'command_reused'
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
    message: string
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
    details: Omit<
      Parameters<PresentationManualEditTracePort['record']>[0],
      'commandId' | 'documentId' | 'stage'
    > = {}
  ): void {
    this.deps.trace?.record({
      commandId: command.commandId,
      documentId: command.documentId,
      stage,
      operation: command.operation.op,
      ...details,
    });
  }
}

/** 插入对象 literal 的行号随人工值序列化移动；投影快照需按新源码同步它们的定位。 */
function relocateProjectedInsertions(
  projection: ManualEditDeckProjection,
  written: {
    readonly source: string;
    readonly manualEdits: {
      readonly slides: readonly { readonly additions?: readonly unknown[] }[];
    };
  }
): ManualEditDeckProjection {
  if (
    projection.kind !== 'projected' ||
    !written.manualEdits.slides.some(slide => slide.additions?.length)
  )
    return projection;
  return {
    kind: 'projected',
    deckSpec: relocateInsertedObjectSpans(projection.deckSpec, written.source),
  };
}
