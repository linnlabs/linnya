import { assertProjectDeletable } from '../../../../../domains/projects';
import type { ConversationCleanupUseCasePort } from '../../conversation-lifecycle';
import {
  ProjectDeletionIncompleteError,
  type ProjectDeletionCatalogPort,
  type ProjectDeletionUseCasePort,
} from '../definitions/projectDeletion';

/** 父项目最后删除；会话清理失败时保留归属，避免把未清完的会话变成无项目历史。 */
export function createProjectDeletionUseCase(input: {
  readonly catalog: ProjectDeletionCatalogPort;
  readonly conversations: Pick<ConversationCleanupUseCasePort, 'requestDeletion'>;
}): ProjectDeletionUseCasePort {
  return {
    async requestDeletion(projectId) {
      assertProjectDeletable(input.catalog.getProject(projectId));
      try {
        for (const conversationId of input.catalog.beginDeletion(projectId)) {
          // 重试包含原删除范围：已清完的会话幂等返回，未完成的复用持久 cleanup job。
          await input.conversations.requestDeletion(conversationId);
        }
        input.catalog.commitDeletion(projectId);
      } catch (cause: unknown) {
        throw new ProjectDeletionIncompleteError(projectId, cause);
      }
    },
  };
}
