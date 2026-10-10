import { z } from 'zod';
import { WorkspaceFileLocatorSchema } from '../file-locator';

export const RESEARCH_AGENT_ID = 'research_v1';

const Text = z.string().trim().min(1);
const WorkspaceLocator = WorkspaceFileLocatorSchema;
export const ResearchStageSchema = z.enum([
  'investigation',
  'investigation_review',
  'draft',
  'argument_review',
  'source_review',
  'revision',
]);
/** Host-only admission; no model-authored stage graph or correctness status. */
export const ResearchRunArgsSchema = z
  .object({
    question: Text,
    reader: Text,
    task_type: z.enum(['open', 'fixed', 'update']),
    materials: z.array(WorkspaceLocator),
    time_range: Text.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.task_type !== 'open' && value.materials.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['materials'],
        message: 'Fixed/update research requires input documents',
      });
    }
    if (new Set(value.materials).size !== value.materials.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['materials'],
        message: 'Input document locators must be unique',
      });
    }
  });
const ResearchDocumentVersion = {
  path: WorkspaceLocator,
  inode: Text,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  citation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
export const ParentResearchStageSchema = z.enum(['investigation', 'draft', 'revision']);
export const ResearchChildArtifactSchema = z.object({
  stage: ResearchStageSchema,
  subrun_id: Text,
  ...ResearchDocumentVersion,
}).strict();
export const ResearchParentArtifactSchema = z.object({
  stage: ParentResearchStageSchema,
  run_id: Text,
  ...ResearchDocumentVersion,
}).strict();
/** 父作者和独立子角色保留各自真实身份，不为父作者补造 subrun。 */
export const ResearchRunArtifactSchema = z.union([
  ResearchChildArtifactSchema,
  ResearchParentArtifactSchema,
]);
export const ResearchRunDataSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('delivered'),
        model_id: Text,
        subrun_ids: z.array(Text),
        artifacts: z.array(ResearchChildArtifactSchema).length(6),
      })
      .strict(),
    z
      .object({
        status: z.literal('inputs_changed'),
        model_id: Text,
        subrun_ids: z.array(Text),
        artifacts: z.array(ResearchChildArtifactSchema).max(6),
        changed_paths: z.array(WorkspaceLocator).min(1),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    const stages = value.artifacts.map(item => item.stage);
    if (
      JSON.stringify(value.subrun_ids) !==
      JSON.stringify(value.artifacts.map(item => item.subrun_id))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subrun_ids'],
        message:
          'Committed child IDs must match artifact order; other started children remain in the trace summary',
      });
    }
    if (
      new Set(stages).size !== stages.length ||
      new Set(value.artifacts.map(item => item.subrun_id)).size !== stages.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifacts'],
        message: 'Each stage and child identity must occur only once',
      });
    }
  });
export const ResearchRunStructuredResultSchema = z
  .object({
    data: ResearchRunDataSchema,
    observation: Text,
  })
  .strict();
export type ResearchRunStructuredResult = z.infer<typeof ResearchRunStructuredResultSchema>;
export type ResearchRunArgs = z.infer<typeof ResearchRunArgsSchema>;
export type ResearchStage = z.infer<typeof ResearchStageSchema>;
export type ResearchRunArtifact = z.infer<typeof ResearchRunArtifactSchema>;
export type ResearchChildArtifact = z.infer<typeof ResearchChildArtifactSchema>;
export type ResearchParentArtifact = z.infer<typeof ResearchParentArtifactSchema>;
export type ParentResearchStage = z.infer<typeof ParentResearchStageSchema>;
export type ResearchRunData = z.infer<typeof ResearchRunDataSchema>;

// Markdown 首行缩进和首尾空白可能有语义；只判空，不改写提交正文。
const ResearchDocumentContent = z.string().min(1)
  .refine(content => content.trim().length > 0, '正文不能只包含空白。');
/** 子角色只能提交预先绑定阶段的正文；身份和路径不由模型填写。 */
export const ChildResearchDocumentArgsSchema = z.object({
  content: ResearchDocumentContent,
}).strict();
/** 父作者显式声明本次文稿和依赖；Host 冻结真实输入版本并分配新文稿路径。 */
export const ParentResearchDocumentArgsSchema = z.object({
  stage: ParentResearchStageSchema,
  input_documents: z.array(WorkspaceLocator).refine(
    documents => new Set(documents).size === documents.length,
    'Input document locators must be unique',
  ),
  content: ResearchDocumentContent,
}).strict();
export const SubmitResearchDocumentArgsSchema = z.union([
  ChildResearchDocumentArgsSchema,
  ParentResearchDocumentArgsSchema,
]);
export const SubmitResearchDocumentResultSchema = z
  .object({ data: ResearchRunArtifactSchema, observation: Text })
  .strict();
/** 父作者保存后继续调查/复核；只有绑定的子角色提交才结束该 child。 */
export const SubmitResearchDocumentToolOutputSchema = z.union([
  z.object({
    data: ResearchChildArtifactSchema,
    observation: Text,
    control: z.object({ terminateRun: z.literal(true), finalAnswer: Text }).strict(),
  }).strict(),
  z.object({ data: ResearchParentArtifactSchema, observation: Text }).strict(),
]);
export type ChildResearchDocumentArgs = z.infer<typeof ChildResearchDocumentArgsSchema>;
export type ParentResearchDocumentArgs = z.infer<typeof ParentResearchDocumentArgsSchema>;
export type SubmitResearchDocumentArgs = z.infer<typeof SubmitResearchDocumentArgsSchema>;
