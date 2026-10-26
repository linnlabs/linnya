import type { ManagedSkill } from '@app/schemas';
export interface SkillManagementState {
  skills: readonly ManagedSkill[];
  loading: boolean;
  busy: boolean;
  selected: ManagedSkill | null;
  file: string;
  original: string | null;
  draft: string;
  feedback: { kind: 'success' | 'error'; message: string } | null;
}
