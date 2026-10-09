import { z } from 'zod';
import { ResearchRunArgsSchema, ResearchStageSchema, WorkspaceFileLocatorSchema } from '@app/schemas';
import type { ResearchDocumentBinding } from '../../../../application/research/definitions/researchDocumentPort';
import type { PreparedResearchStage } from '../../../../application/research/definitions/researchStageReceipt';

const Text = z.string().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);

export const ResearchDocumentBindingStorageSchema: z.ZodType<ResearchDocumentBinding> = z.object({
  inode: Text.regex(/^workspace:.+$/),
  locator: WorkspaceFileLocatorSchema,
  representation: z.literal('workspace-markdown-current-v1'),
  sha256: Hash,
  citationSha256: Hash,
}).strict();

export const PreparedResearchStageStorageSchema: z.ZodType<PreparedResearchStage> = z.object({
  stage: ResearchStageSchema,
  invocation: ResearchRunArgsSchema,
  subrunId: Text,
  request: z.object({
    promptKey: Text,
    // 冻结已准备的完整请求；重启后不重新拼 prompt，也不 trim 模型实际收到的文本。
    query: Text,
    methodVersion: z.literal('research-feedback-v1'),
    requiredResources: z.array(z.enum([
      'references/modeling.md', 'references/article-craft.md', 'references/business-analysis.md',
    ])),
  }).strict(),
  inputs: z.array(ResearchDocumentBindingStorageSchema),
  outputPath: WorkspaceFileLocatorSchema,
}).strict();

export const ResearchStageReceiptRowSchema = z.object({
  parent_run_id: Text,
  tool_call_id: Text,
  stage: ResearchStageSchema,
  project_id: Text,
  conversation_id: Text,
  model_id: Text,
  prepared_json: Text,
  artifact_json: Text.nullable(),
}).strict();

export type ResearchStageReceiptRow = z.infer<typeof ResearchStageReceiptRowSchema>;
