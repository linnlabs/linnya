import type { ManagedSkill } from '@app/schemas';

/** 卡片只拥有入口文件的已保存内容，不跟随弹窗中的文件导航或草稿。 */
export interface SkillPreviewState {
  readonly skill: ManagedSkill;
  readonly content: string | null;
}

export interface SkillDetailState {
  readonly skill: ManagedSkill;
  readonly file: string;
  /** 读取失败时为 null：此时编辑区只读，不能保存。 */
  readonly original: string | null;
  readonly draft: string;
}

export interface SkillManagementState {
  skills: readonly ManagedSkill[];
  /** 首次读取列表；之后的刷新静默进行，不再显示骨架。 */
  loading: boolean;
  busy: boolean;
  preview: SkillPreviewState | null;
  detail: SkillDetailState | null;
  feedback: { kind: 'success' | 'error'; message: string } | null;
}
