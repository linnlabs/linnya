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
      readonly draft: string;
      readonly baseline: string;
      readonly composing: boolean;
      readonly finishRequested: boolean;
    };

/** 已交接队列的文字只保留显示/恢复草稿，不再持有输入焦点。 */
export interface TextDraftPresentation {
  readonly sessionId: string;
  readonly clientOperationId: string;
  readonly target: TextEditingTarget;
  readonly content: string;
  readonly status: 'pending' | 'failed';
  readonly message?: string;
}

export interface SlideEditingInteractionOptions {
  /** 当前正式画面是否仍可命中。提交中的旧画面也应允许用户表达下一次选择。 */
  readonly canSelect: Ref<boolean>;
  readonly currentSlide: Ref<SlideRenderModel | null>;
  readonly renderScale: Ref<number>;
  readonly slideSize: Ref<{ readonly width: number; readonly height: number }>;
  readonly wrapperRef: Ref<HTMLElement | null>;
  readonly visualPreview?: Readonly<Ref<ManualEditingVisualPreview | null>>;
  readonly submitIntent: ManualEditSubmissionPort['enqueue'];
  readonly focusCanvas?: () => void;
}
