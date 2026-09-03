export class ConversationRuntimeInitializationError extends Error {
  constructor(
    readonly initializationFailure: unknown,
    readonly cleanupFailures: readonly unknown[],
  ) {
    super(cleanupFailures.length === 0
      ? 'Conversation runtime 初始化失败，Commands 与 Profiled Code Sandbox owner 已收口'
      : 'Conversation runtime 初始化失败，且存在未收口的运行时 owner');
    this.name = 'ConversationRuntimeInitializationError';
  }
}
