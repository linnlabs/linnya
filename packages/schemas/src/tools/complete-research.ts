import { z } from 'zod';
import { WorkspaceFileLocatorSchema } from '../file-locator';
import { ResearchRunArtifactSchema } from './research-run';

/** 交付只引用已经保存的稿件，不重复传正文，也不接纳模型填写的检查状态。 */
export const CompleteResearchArgsSchema = z.object({
  document: WorkspaceFileLocatorSchema,
}).strict();
export const CompleteResearchResultSchema = z.object({
  data: z.object({
    artifact: ResearchRunArtifactSchema,
    review_artifacts: z.array(ResearchRunArtifactSchema).length(2),
  }).strict(),
  observation: z.string().min(1),
}).strict();
export const CompleteResearchToolOutputSchema = CompleteResearchResultSchema.extend({
  control: z.object({ terminateRun: z.literal(true), finalAnswer: z.string().min(1) }).strict(),
}).strict();
export type CompleteResearchArgs = z.infer<typeof CompleteResearchArgsSchema>;
export type CompleteResearchData = z.infer<typeof CompleteResearchResultSchema>['data'];
