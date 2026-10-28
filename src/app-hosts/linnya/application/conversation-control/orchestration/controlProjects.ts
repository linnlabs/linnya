import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlProjectsRequest,
  type ConversationControlProjectsResponse,
} from '@app/schemas';
import {
  ProjectNameConflictError,
  ProjectNotFoundError,
  ProjectNotEmptyError,
  ProjectDeleteBlockedError,
  type ProjectLifecyclePort,
} from 'src/domains/projects';
import { ConversationControlError } from '../definitions/conversationControlError';
import { projectControlRecord } from '../functions/projectControlRecord';

/** 外部控制动作只委托项目 owner，不复制重名、默认项目或持久化规则。 */
export function controlProjects(
  projects: Pick<ProjectLifecyclePort, 'list' | 'get' | 'create' | 'update' | 'deleteEmpty'>,
  request: ConversationControlProjectsRequest
): ConversationControlProjectsResponse {
  const base = {
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: true,
    command: 'projects',
  } as const;
  try {
    switch (request.action) {
      case 'delete':
        projects.deleteEmpty(request.project_id);
        return { ...base, action: 'delete', project_id: request.project_id };
      case 'list':
        return {
          ...base,
          action: 'list',
          projects: projects
            .list()
            .map(project => ({ project_id: project.id, name: project.name })),
        };
      case 'get':
        return {
          ...base,
          action: 'get',
          project: projectControlRecord(projects.get(request.project_id)),
        };
      case 'create': {
        const projectId = projects.create(request.input);
        return {
          ...base,
          action: 'create',
          project: projectControlRecord(projects.get(projectId)),
        };
      }
      case 'update': {
        projects.update(request.project_id, request.updates);
        return {
          ...base,
          action: 'update',
          project: projectControlRecord(projects.get(request.project_id)),
        };
      }
    }
  } catch (error: unknown) {
    if (error instanceof ProjectNotEmptyError) {
      throw new ConversationControlError('project_not_empty', error.message);
    }
    if (error instanceof ProjectDeleteBlockedError) {
      throw new ConversationControlError('project_delete_blocked', error.message);
    }
    if (error instanceof ProjectNameConflictError) {
      throw new ConversationControlError('project_name_conflict', error.message);
    }
    if (error instanceof ProjectNotFoundError) {
      throw new ConversationControlError('project_not_found', error.message);
    }
    throw error;
  }
}
