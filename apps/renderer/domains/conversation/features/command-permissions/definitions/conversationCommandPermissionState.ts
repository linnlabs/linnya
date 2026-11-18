import type { ConversationCommandPermissionView } from '@app/schemas/commands';

export interface ConversationCommandPermissionState {
  readonly current?: ConversationCommandPermissionView;
  readonly loadState: 'loading' | 'ready' | 'unavailable';
  readonly busy: boolean;
}
