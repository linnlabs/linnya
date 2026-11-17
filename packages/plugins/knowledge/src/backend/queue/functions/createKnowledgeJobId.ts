import { randomUUID } from 'node:crypto';

/** 保留既有摄入任务及文档身份格式。 */
export function createKnowledgeJobId(): string {
  return `task-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
