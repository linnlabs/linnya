import { z } from 'zod';
import type { BenchmarkConversationCliPort } from '../../../definitions/conversationCliPort';
import type { BenchmarkRunOutcome } from '../../../definitions/benchmarkRun';

const ReasoningSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

/** 一批 Slides 设计基准：若干简报，每份跑若干次，每次一个新项目。 */
export const SlidesDesignBatchManifestSchema = z
  .object({
    schema_version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    agent: z.string().trim().min(1).default('slides_agent'),
    model: z.string().trim().min(1).optional(),
    reasoning: ReasoningSchema.default('high'),
    concurrency: z.number().int().min(1).max(12).default(6),
    timeout_minutes: z.number().int().min(5).max(240).default(90),
    /** 计划卡等待批准时自动批准的最多次数；超过后停在 requires_user。 */
    max_approvals: z.number().int().min(0).max(8).default(4),
    briefs: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/u),
            prompt: z.string().trim().min(1),
            runs: z.number().int().min(1).max(12),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = new Set<string>();
    for (const [index, brief] of manifest.briefs.entries()) {
      if (keys.has(brief.key)) {
        context.addIssue({ code: 'custom', path: ['briefs', index, 'key'], message: `Duplicate brief key: ${brief.key}` });
      }
      keys.add(brief.key);
    }
  });

export type SlidesDesignBatchManifest = z.infer<typeof SlidesDesignBatchManifestSchema>;

/**
 * 单次试跑的状态。`interrupted` 表示上次 runner 中断时它已经发出，结果未知；
 * 续跑不会重发，避免重复花费，需要人工核对该会话。
 */
export interface SlidesDesignBatchRunState {
  readonly runKey: string;
  readonly briefKey: string;
  readonly index: number;
  readonly projectId?: string;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly status: 'pending' | 'running' | 'finished' | 'interrupted';
  readonly outcome?: BenchmarkRunOutcome;
  readonly durationMs?: number;
  readonly factsFile?: string;
  readonly error?: string;
}

export interface SlidesDesignBatchState {
  readonly schema_version: 1;
  readonly name: string;
  readonly manifestFile: string;
  readonly agent: string;
  readonly model?: string;
  readonly reasoning: z.infer<typeof ReasoningSchema>;
  readonly runs: readonly SlidesDesignBatchRunState[];
}

export interface SlidesDesignBatchCliPort extends BenchmarkConversationCliPort {
  createProject(name: string): Promise<{ readonly projectId: string }>;
}
