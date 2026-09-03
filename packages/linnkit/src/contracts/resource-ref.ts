import { z } from 'zod';

const NonBlankIdentitySchema = z.string().max(200).refine(
  value => value.trim().length > 0 && value === value.trim(),
  { message: 'resource identity must be non-blank and trimmed' },
);

const FileNameSchema = z.string().max(255).refine(
  value => value.trim().length > 0
    && value === value.trim()
    && !value.includes('/')
    && !value.includes('\\'),
  { message: 'resource fileName must be a non-blank basename' },
);

const LabelSchema = z.string().max(200).refine(
  value => value.trim().length > 0 && value === value.trim(),
  { message: 'resource label must be non-blank and trimmed' },
);

export const RuntimeResourceRef = z.object({
  id: NonBlankIdentitySchema,
  kind: z.literal('image'),
  resourceId: NonBlankIdentitySchema,
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters'),
  fileName: FileNameSchema.optional(),
  label: LabelSchema.optional(),
}).strict();

export const RuntimeResourceRefs = z.array(RuntimeResourceRef).min(1);

export type RuntimeResourceRef = z.infer<typeof RuntimeResourceRef>;
