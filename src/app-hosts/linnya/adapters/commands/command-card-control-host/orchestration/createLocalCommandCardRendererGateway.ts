import type {
  CommandCardRendererControlPort,
  CommandCardRendererGatewayPort,
} from '../definitions/commandCardControlHost';

/** 本地测试 composition 只暴露异步 gateway，不泄漏完整命令卡 owner 生命周期。 */
export function createLocalCommandCardRendererGateway(
  host: CommandCardRendererControlPort,
): CommandCardRendererGatewayPort {
  const gateway: CommandCardRendererGatewayPort = {
    openRendererPage: (ownerId, conversationId) => (
      host.openRendererPage(ownerId, conversationId)
    ),
    readRendererPage: input => host.readRendererPage(input),
    invalidateRendererPage(input) {
      host.invalidateRendererPage(input);
    },
    cancel: input => host.cancel(input),
    submitProtectedInput: input => host.submitProtectedInput(input),
    subscribe: listener => host.subscribe(listener),
  };
  return Object.freeze(gateway);
}
