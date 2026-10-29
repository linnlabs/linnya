import type { SlidesEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import type { Ref } from 'vue';
import type { SlideRenderModel } from '../../../types/render';
import type { ManualEditSubmissionPort, ManualEditingVisualPreview } from '../../manualEditing';
import type { TextEditingTarget } from '../../textEditing';

export type TextInputSession =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'editing';
      readonly sessionId: string;
      readonly target: TextEditingTarget;
      readonly draft: SlidesEditableTextContent;
      readonly baseline: SlidesEditableTextContent;
      readonly composing: boolean;
      readonly finishRequested: boolean;
      /** 新插入的文字框以全选打开，直接输入即替换占位文字。 */
      readonly selectAll?: boolean;
    };

/** 已交接队列的文字只保留显示/恢复草稿，不再持有输入焦点。 */
export interface TextDraftPresentation {
  readonly sessionId: string;
  readonly clientOperationId: string;
  readonly target: TextEditingTarget;
  readonly content: SlidesEditableTextContent;
  readonly status: 'pending' | 'failed';
  readonly message?: string;
}

export interface SlideEditingInteractionOptions {
  /** 当前正式画面是否仍可命中。提交中的旧画面也应允许用户表达下一次选择。 */
  readonly canSelect: Ref<boolean>;
  /** 当前文稿能否手动写入；不能时仍可选中对象交给 AI，但不移动、不删除、不进入文字输入。省略表示可写。 */
  readonly canMutate?: Ref<boolean>;
  readonly currentSlide: Ref<SlideRenderModel | null>;
  readonly renderScale: Ref<number>;
  readonly slideSize: Ref<{ readonly width: number; readonly height: number }>;
  readonly wrapperRef: Ref<HTMLElement | null>;
  readonly visualPreview?: Readonly<Ref<ManualEditingVisualPreview | null>>;
  readonly submitIntent: ManualEditSubmissionPort['enqueue'];
  readonly focusCanvas?: () => void;
}
