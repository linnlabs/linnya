import type { ManagedSkill } from '@app/schemas';

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
  detail: SkillDetailState | null;
  /** 预览与编辑共用文件事实；只有显式进入编辑时才打开弹窗。 */
  editorOpen: boolean;
  feedback: { kind: 'success' | 'error'; message: string } | null;
}
