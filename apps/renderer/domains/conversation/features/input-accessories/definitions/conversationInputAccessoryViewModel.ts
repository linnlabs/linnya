import type {
  ConversationInputAccessoryComposerCommands,
  ConversationInputAccessoryContribution,
} from '@linnya/plugin-host-contract/renderer';

/** 宿主槽真正渲染的数据；业务 contribution 在编排层被绑定为 owner-scoped commands。 */
export interface ConversationInputAccessoryViewModel {
  readonly key: string;
  readonly component: ConversationInputAccessoryContribution['component'];
  readonly composer: ConversationInputAccessoryComposerCommands;
}
