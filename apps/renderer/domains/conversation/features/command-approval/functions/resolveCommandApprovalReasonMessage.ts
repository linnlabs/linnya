import type { CommandApprovalReason } from '@app/schemas/commands';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

export function resolveCommandApprovalReasonMessage(
  reason: CommandApprovalReason,
): ConversationMessageKey {
  if (reason.type === 'permission_elevation') {
    return 'conversation.commandApproval.reason.permissionElevation';
  }
  switch (reason.category) {
    case 'delete':
      return 'conversation.commandApproval.reason.delete';
    case 'move_overwrite_rename':
      return 'conversation.commandApproval.reason.moveOverwriteRename';
    case 'external_upload':
      return 'conversation.commandApproval.reason.externalUpload';
    case 'download_and_execute':
      return 'conversation.commandApproval.reason.downloadAndExecute';
    case 'system_or_disk_impact':
      return 'conversation.commandApproval.reason.systemOrDiskImpact';
  }
}
