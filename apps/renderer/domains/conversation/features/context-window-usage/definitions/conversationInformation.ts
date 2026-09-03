export interface ConversationInformationProjectionInput {
  readonly createdAt: number;
  readonly messages: readonly { readonly type: string }[];
  readonly persistedUserMessageCount?: number;
}

export interface ConversationInformationPresentation {
  readonly createdAt: number;
  readonly userMessageCount: number;
}
