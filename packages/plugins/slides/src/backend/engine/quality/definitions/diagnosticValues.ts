import { z } from 'zod';

export const DiagnosticBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
  unit: z.literal('in'),
}).strict();
export type DiagnosticBox = z.infer<typeof DiagnosticBoxSchema>;

/**
 * finding 只携带定位与最终布局所需的窄节点事实。
 * 完整样式、原文和子树仍由 scene graph / read_file 各自拥有。
 */
export const DiagnosticNodeRefSchema = z.object({
  nodeId: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  label: z.string().trim().min(1),
  finalBox: DiagnosticBoxSchema,
  zIndex: z.number().int(),
  parentNodeId: z.string().trim().min(1).optional(),
}).strict();
export type DiagnosticNodeRef = z.infer<typeof DiagnosticNodeRefSchema>;

const DirectCreationDiagnosticSourceRefSchema = z.object({
  kind: z.literal('direct_creation'),
  slideNumber: z.number().int().positive(),
  nodeId: z.string().trim().min(1),
  locator: z.string().trim().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  generatedNodeCount: z.literal(1),
}).strict();

const SharedCreationDiagnosticSourceRefSchema = z.object({
  kind: z.literal('shared_creation'),
  slideNumber: z.number().int().positive(),
  nodeId: z.string().trim().min(1),
  locator: z.string().trim().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  generatedNodeCount: z.number().int().min(2),
}).strict();

const SlideDiagnosticSourceRefSchema = z.object({
  kind: z.literal('slide'),
  slideNumber: z.number().int().positive(),
  nodeId: z.string().trim().min(1).optional(),
  locator: z.string().trim().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).strict();

const UnavailableDiagnosticSourceRefSchema = z.object({
  kind: z.literal('unavailable'),
  slideNumber: z.number().int().positive(),
  nodeId: z.string().trim().min(1).optional(),
  reason: z.enum([
    'source_kind_unsupported',
    'source_location_unavailable',
    'source_identity_unresolved',
  ]),
}).strict();

export const DiagnosticSourceRefSchema = z.discriminatedUnion('kind', [
  DirectCreationDiagnosticSourceRefSchema,
  SharedCreationDiagnosticSourceRefSchema,
  SlideDiagnosticSourceRefSchema,
  UnavailableDiagnosticSourceRefSchema,
]).superRefine((source, context) => {
  if (source.kind !== 'unavailable' && source.endLine < source.startLine) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endLine'],
      message: 'endLine must be greater than or equal to startLine',
    });
  }
});
export type DiagnosticSourceRef = z.infer<typeof DiagnosticSourceRefSchema>;

export const DiagnosticIntentSchema = z.object({
  assessment: z.enum(['unknown', 'likely_intentional', 'likely_unintentional']),
  signals: z.array(z.string().trim().min(1)).min(1),
}).strict();
export type DiagnosticIntent = z.infer<typeof DiagnosticIntentSchema>;

export const DiagnosticVerificationSchema = z.enum(['inspect', 'render']);
export type DiagnosticVerification = z.infer<typeof DiagnosticVerificationSchema>;

export const DiagnosticDispositionSchema = z.enum(['fix', 'review', 'informational']);
export type DiagnosticDisposition = z.infer<typeof DiagnosticDispositionSchema>;

export const DiagnosticSideSchema = z.enum(['left', 'right', 'top', 'bottom']);
export type DiagnosticSide = z.infer<typeof DiagnosticSideSchema>;

export const DiagnosticAxisSchema = z.enum(['horizontal', 'vertical']);
export type DiagnosticAxis = z.infer<typeof DiagnosticAxisSchema>;
