import type {
  CommandApprovalRendererGatewayPort,
  CommandApprovalRendererPagePort,
} from '../definitions/commandApprovalHost';

/** 本地测试 composition 也经过异步 gateway，避免调用方绕过正式审批合同。 */
export function createLocalCommandApprovalRendererGateway(
  host: CommandApprovalRendererPagePort,
): CommandApprovalRendererGatewayPort {
  const gateway: CommandApprovalRendererGatewayPort = {
    async openRendererPage(ownerId) {
      return host.openRendererPage(ownerId);
    },
    async readRendererPage(input) {
      return host.readRendererPage(input);
    },
    invalidateRendererPage(input) {
      host.invalidateRendererPage(input);
    },
    async submitRendererReply(input) {
      return host.submitRendererReply(input);
    },
    subscribe(listener) {
      return host.subscribe(listener);
    },
  };
  return Object.freeze(gateway);
}
