import type { z } from 'zod';
import { ProjectRecordSchema } from '@app/schemas';

// 数据库还保存内部 metadata_json；只选取公开记录所需列，禁止把内部字段透传给客户端。
export const ProjectRowSchema = ProjectRecordSchema.omit({ can_delete: true });
export type ProjectRow = z.infer<typeof ProjectRowSchema>;
