import type Database from 'better-sqlite3';
import type { ProjectConversationsQuery, ProjectConversationsQueryRequest } from '@app/schemas';
import type { ConversationActivityPorts } from '../../conversation-activity';
import { readConversationActivities } from '../../conversation-activity';
import { readProjectConversations } from './readProjectConversations';
import { searchProjectConversations } from './searchProjectConversations';
import { filterProjectConversations, sortProjectConversations } from '../functions/projectConversationQuery';

/** 面板和 Shell 的唯一项目查询；准入使用调用方授权的 project_id，绝不读取当前 UI 项目。 */
export async function queryProjectConversations(
  db: Database.Database,
  request: ProjectConversationsQueryRequest,
  activity: ConversationActivityPorts,
  now = new Date(),
): Promise<ProjectConversationsQuery> {
  const rows = readProjectConversations(db, request).conversations;
  const filtered = filterProjectConversations(rows, request, now);
  const search = request.query ? searchProjectConversations(db, request,
    new Set(filtered.map(row => row.conversation_id))) : null;
  const excerpts = Object.fromEntries(search?.matches.map(match => [match.conversation_id, match.excerpt]) ?? []);
  const conversations = sortProjectConversations(filtered.filter(row => !search || Object.prototype.hasOwnProperty.call(excerpts, row.conversation_id)), request);
  const activities = await readConversationActivities(activity, conversations.map(row => row.conversation_id));
  return { project_id: request.project_id, conversations, excerpts, activities, truncated: search?.truncated ?? false };
}
