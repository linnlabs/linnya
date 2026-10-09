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
export const ResearchRunArtifactSchema = z
  .object({
    stage: ResearchStageSchema,
    subrun_id: Text,
    path: WorkspaceLocator,
    inode: Text,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    citation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ResearchRunDataSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('delivered'),
        model_id: Text,
        subrun_ids: z.array(Text),
        artifacts: z.array(ResearchRunArtifactSchema).length(6),
      })
      .strict(),
    z
      .object({
        status: z.literal('inputs_changed'),
        model_id: Text,
        subrun_ids: z.array(Text),
        artifacts: z.array(ResearchRunArtifactSchema).max(6),
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
export type ResearchRunData = z.infer<typeof ResearchRunDataSchema>;
