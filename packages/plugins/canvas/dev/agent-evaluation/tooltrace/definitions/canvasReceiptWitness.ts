import { z } from 'zod';
import { CanvasAgentReceiptQueryResultSchema } from '@plugin/canvas/shared';
import { CanvasTraceWitnessScopeSchema } from './traceDraft';
export const CanvasReceiptWitnessRequestSchema = z
  .object({
    runDirectory: z.string().min(1),
    collectionLabel: z.string().regex(/^[a-zA-Z0-9-]+$/),
    artifactRoot: z.string().min(1),
    databasePath: z.string().min(1),
    requestIds: z.array(z.string().min(1).max(160)).min(1),
  })
  .strict();
export const CanvasReceiptReaderRequestSchema = z
  .object({
    hostAppRoot: z.string(),
    artifactRoot: z.string(),
    databasePath: z.string(),
    profileDirectory: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    documentPath: z.string(),
    requestId: z.string(),
  })
  .strict();
export type CanvasReceiptReaderRequest = z.infer<typeof CanvasReceiptReaderRequestSchema>;
export const CanvasReceiptWitnessSchema = z
  .object({
    scope: CanvasTraceWitnessScopeSchema,
    projectId: z.string(),
    documentPath: z.string().startsWith('workspace:'),
    reader: z
      .object({
        cliEntry: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        hostAppRoot: z.string(),
      })
      .strict(),
    complete: z.boolean(),
    queries: z.array(
      z
        .object({
          requestId: z.string(),
          exitCode: z.number().int(),
          responseFile: z.string().nullable(),
          response: CanvasAgentReceiptQueryResultSchema.nullable(),
          failure: z.enum(['process_failed', 'invalid_response']).nullable(),
        })
        .strict()
    ),
    evidenceFiles: z.array(z.string()).min(1),
  })
  .strict();
export type CanvasReceiptWitness = z.infer<typeof CanvasReceiptWitnessSchema>;
export interface CanvasReceiptReader {
  read(input: {
    readonly request: CanvasReceiptReaderRequest;
    readonly directory: string;
    readonly label: string;
  }): Promise<{
    readonly exitCode: number;
    readonly value: unknown;
    readonly evidenceFiles: readonly string[];
    readonly responseFile: string | null;
  }>;
}
