import type {
  CommandApprovalChoice,
  CommandApprovalRequestV1,
} from '@app/schemas/commands';

export function isCommandApprovalChoiceAvailable(input: {
  readonly request: CommandApprovalRequestV1;
  readonly choice: CommandApprovalChoice;
}): boolean {
  // Renderer 只能提交 request 已明确暴露的业务选择。
  return input.request.available_choices.some(choice => choice === input.choice);
}
