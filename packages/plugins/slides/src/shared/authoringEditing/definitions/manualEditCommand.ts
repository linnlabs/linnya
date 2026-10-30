import type { SlidesInsertedObject } from './insertedObject';
import type { SlidesEditableTextContent, SlidesTextStylePatch } from './editableText';
import type { SlidesAuthoringEditRef } from './authoringIdentity';
import type {
  SlidesManualTargetKind,
  SlidesManualTranslation,
  SlidesManualVisualSize,
} from './manualEdits';

export interface SlidesManualEditExpectedBase {
  readonly revisionId: string;
  readonly revision: number;
  readonly sourceHash: string;
}

export type SlidesManualEditOperation =
  | { readonly op: 'set_text_width'; readonly target: SlidesAuthoringEditRef; readonly targetKind: 'text'; readonly width: number }
  | { readonly op: 'set_image'; readonly target: SlidesAuthoringEditRef; readonly targetKind: 'image'; readonly assetId?: string; readonly fit?: 'contain' | 'cover' }
  | {
      readonly op: 'set_text_content';
      readonly targetKind: 'text';
      readonly target: SlidesAuthoringEditRef;
      readonly content: SlidesEditableTextContent;
    }
  | {
      readonly op: 'set_text_content';
      readonly targetKind: 'shape';
      readonly target: SlidesAuthoringEditRef;
      readonly content: string;
    }
  | {
      readonly op: 'set_translation';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
      readonly translation: SlidesManualTranslation;
    }
  | {
      readonly op: 'translate_by';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
      readonly delta: SlidesManualTranslation;
    }
  | (SlidesTextStylePatch & { readonly op: 'set_text_style'; readonly target: SlidesAuthoringEditRef })
  | {
      readonly op: 'set_fill_color';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: 'frame' | 'shape';
      readonly color: string;
    }
  | {
      readonly op: 'set_visual_size';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: 'shape' | 'image';
      readonly visualSize: SlidesManualVisualSize;
      /** 缩放锚点产生的位置增量，与尺寸在同一修订中提交。 */
      readonly translationDelta?: SlidesManualTranslation;
    }
  | {
      readonly op: 'delete_target';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
    };

/**
 * 页面列表结构写入。index 是新页在 expectedBase 精确修订中的 0-based 位置，
 * 只在该源码快照内解释；它不是页面身份，也不会持久化。
 */
export interface SlidesManualSlideInsertOperation {
  readonly op: 'insert_blank_slide';
  readonly index: number;
}

export type SlidesManualEditCommandOperation =
  | SlidesManualEditOperation
  | { readonly op: 'insert_objects'; readonly index: number; readonly objects: readonly SlidesInsertedObject[] }
  | { readonly op: 'set_layer'; readonly target: SlidesAuthoringEditRef; readonly direction: 'front' | 'back' | 'forward' | 'backward' }
  | { readonly op: 'undo' }
  | { readonly op: 'redo' }
  | { readonly op: 'batch'; readonly operations: readonly SlidesManualEditOperation[] }
  | SlidesManualSlideInsertOperation
  | { readonly op: 'duplicate_slide'; readonly index: number }
  | { readonly op: 'delete_slide'; readonly index: number }
  | { readonly op: 'move_slide'; readonly index: number; readonly toIndex: number };

export interface SlidesManualEditCommand {
  readonly commandId: string;
  readonly documentId: string;
  readonly expectedBase: SlidesManualEditExpectedBase;
  readonly operation: SlidesManualEditCommandOperation;
}

export interface SlidesManualEditHistoryStatus {
  readonly revisionId: string;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

/** 撤销或重做后应呈现的位置：页序号属于恢复后的文稿，对象可能已不存在。 */
export interface SlidesManualEditHistoryFocus {
  readonly slideIndex: number;
  readonly targets: readonly SlidesAuthoringEditRef[];
}

export interface SlidesManualEditCommitResult {
  readonly status: 'committed';
  readonly commandId: string;
  readonly documentId: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly history: SlidesManualEditHistoryStatus;
  /** 只在 undo/redo 时返回，让 Renderer 跳到被恢复的页并重新选中对象。 */
  readonly focus?: SlidesManualEditHistoryFocus;
}

export type SlidesManualEditConflictReason =
  | 'stale_base'
  | 'draft_present'
  | 'command_reused';

export interface SlidesManualEditConflictResult {
  readonly status: 'conflict';
  readonly commandId: string;
  readonly documentId: string;
  readonly reason: SlidesManualEditConflictReason;
}

export interface SlidesManualEditValidationFailureResult {
  readonly status: 'validation_failed';
  readonly commandId: string;
  readonly documentId: string;
  readonly code: string;
  readonly message: string;
}

export interface SlidesManualEditBuildFailureResult {
  readonly status: 'build_failed';
  readonly commandId: string;
  readonly documentId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly referenceId?: string;
}

export type SlidesManualEditCommandResult =
  | SlidesManualEditCommitResult
  | SlidesManualEditConflictResult
  | SlidesManualEditValidationFailureResult
  | SlidesManualEditBuildFailureResult;
