import type { SkillAction, SkillManagementRequest } from '@app/schemas';

export type SkillPresentationData =
  | { readonly kind: 'lifecycle' }
  | {
      readonly kind: 'skill';
      readonly action: SkillAction;
      readonly skillName: string;
    }
  | {
      readonly kind: 'resource';
      readonly skillName: string;
    }
  | {
      /** skill_manage：安装、编辑、卸载等对用户 Skill 的维护动作，卡片只显示一行结论。 */
      readonly kind: 'manage';
      readonly action: SkillManagementRequest['action'];
      /** list 没有目标 Skill。 */
      readonly skillName: string | undefined;
      readonly path: string | undefined;
    };
