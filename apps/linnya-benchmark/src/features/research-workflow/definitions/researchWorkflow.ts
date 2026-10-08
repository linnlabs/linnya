import { z } from 'zod';
import {
  ConversationControlAcceptedReceiptSchema,
  ConversationUiMessageSchema,
  WorkspaceDocumentCitationSourceSchema,
} from '@app/schemas';
import type {
  ConversationControlRunStatusSnapshot,
  ConversationControlResumeResponse,
  JsonValue,
} from '@app/schemas';
import type { BenchmarkConversationCliPort } from '../../../definitions/conversationCliPort';

export const stageIds = ['D0', 'R0', 'D1', 'R1'] as const;
export const sourcePacketPolicyVersion = 1;
export const StageIdSchema = z.enum(stageIds);
const locator = z.string().regex(/^workspace:\/[^\n]+$/);
export const ResearchStageSchema = z
  .object({
    id: StageIdSchema,
    agentId: z.string().min(1).optional(),
    modelId: z.string().min(1),
    reasoningEffort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).default('high'),
    skill: z.string().min(1),
    promptFile: z.string().min(1),
    allowedMaterials: z.array(locator).default([]),
    expectedDocuments: z.array(locator).min(1),
    network: z.enum(['allowed', 'forbidden']),
    sourcePacket: z.object({ prefix: locator, index: locator }).strict().optional(),
  })
  .strict();
export const ResearchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1),
    stages: z.array(ResearchStageSchema).min(1).max(4),
  })
  .strict()
  .superRefine((manifest, context) => {
    const order = manifest.stages.map(stage => stageIds.indexOf(stage.id));
    if (order.some((value, index) => index > 0 && value <= (order[index - 1] ?? -1))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages'],
        message: 'Stages must be unique and ordered D0/R0/D1/R1',
      });
    }
    const protectedPaths = manifest.stages.flatMap(stage => [
      ...stage.allowedMaterials,
      ...stage.expectedDocuments,
    ]);
    const packets = manifest.stages.flatMap(stage =>
      stage.sourcePacket ? [stage.sourcePacket] : []
    );
    const prefixes = new Set<string>();
    const indexes = new Set<string>();
    for (const packet of packets) {
      const generated = (locator: string) =>
        locator.startsWith(`${packet.prefix}-`) &&
        /^\d+\.md$/.test(locator.slice(packet.prefix.length + 1));
      if (
        prefixes.has(packet.prefix) ||
        indexes.has(packet.index) ||
        generated(packet.index) ||
        protectedPaths.some(locator => locator === packet.index || generated(locator)) ||
        packets.some(other => other !== packet && generated(other.index))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages'],
          message: 'Source packet targets overlap task documents, materials or another packet',
        });
      }
      prefixes.add(packet.prefix);
      indexes.add(packet.index);
    }
  });
export type ResearchManifest = z.infer<typeof ResearchManifestSchema>;
export type ResearchStage = z.infer<typeof ResearchStageSchema>;
export type StageId = z.infer<typeof StageIdSchema>;
export const ToolMessageSchema = ConversationUiMessageSchema.options[2];
export type ResearchToolMessage = z.infer<typeof ToolMessageSchema>;

export interface ResearchWorkflowCliPort extends BenchmarkConversationCliPort {
  status(
    conversationId: string,
    runId: string
  ): Promise<ConversationControlRunStatusSnapshot | null>;
  resume(conversationId: string, runId: string): Promise<ConversationControlResumeResponse>;
  messagePage(
    conversationId: string,
    before?: number
  ): ReturnType<BenchmarkConversationCliPort['messages']>;
  workspaceTool(request: {
    tool: 'read_file' | 'write_file';
    projectId: string;
    conversationId?: string;
    args: Readonly<Record<string, JsonValue>>;
  }): Promise<ResearchToolMessage>;
}

export const ProjectionSchema = z
  .object({
    locator,
    sha256: z.string(),
    hanCharacters: z.number().int().nonnegative(),
    representation: z.enum(['text', 'document-view']),
    text: z.string(),
    citationSnapshots: z.array(WorkspaceDocumentCitationSourceSchema),
    versionHash: z.string(),
  })
  .strict();
export type Projection = z.infer<typeof ProjectionSchema>;
export const StageStateSchema = z
  .object({
    id: StageIdSchema,
    projectId: z.string(),
    promptHash: z.string(),
    status: z.enum([
      'admission_unknown',
      'observing',
      'paused',
      'awaiting_user',
      'collecting',
      'completed',
      'failed',
      'cancelled',
      'stale',
      'collection_failed',
    ]),
    receipt: ConversationControlAcceptedReceiptSchema.optional(),
    inputs: z.array(ProjectionSchema),
    outputs: z.array(ProjectionSchema).default([]),
    packetDocuments: z.array(ProjectionSchema).default([]),
    // 旧资料包没有来源准入证明；读旧状态不等于授权继续传递旧材料。
    sourcePacketPolicyVersion: z.literal(sourcePacketPolicyVersion).optional(),
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    resumePending: z.boolean().default(false),
    error: z.string().optional(),
    semanticQuality: z.literal('not_evaluated').default('not_evaluated'),
  })
  .strict();
export type StageState = z.infer<typeof StageStateSchema>;
export const WorkflowStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestHash: z.string(),
    stages: z.array(StageStateSchema),
    inspectionConversationId: z.string().optional(),
  })
  .strict();
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
