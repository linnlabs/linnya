import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import type { PendingRevisionDTO as LegacyPendingRevisionDTO } from '../utils/pending/pendingRevisionTypes'

export function mapWorkspacePendingToLegacy(
  dto: WorkspacePendingRevisionDTO
): LegacyPendingRevisionDTO {
  return {
    id: dto.id,
    conversationId: '',
    blockId: typeof dto.blockId === 'string' ? dto.blockId : null,
    operation: dto.operation ?? 'update',
    originalMarkdown: null,
    newMarkdown: typeof dto.newMarkdown === 'string' ? dto.newMarkdown : null,
    createdAt: typeof dto.createdAt === 'number' ? dto.createdAt : undefined,
    metaJson: typeof dto.metaJson === 'string' ? dto.metaJson : null,
    metadata: undefined,
  }
}
