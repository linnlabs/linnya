import type { SkillAction } from '@app/schemas';

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
    };
