import { z } from 'zod';
import { CanvasColorSchema } from '../../model/definitions/canvasElement';

export const CANVAS_CLI_VERSION = 1;
const id = z.string().regex(/^(?:[ce][1-9]\d*|\$[A-Za-z][A-Za-z0-9_-]*)$/);
const placement = {
  ref: z.string().regex(/^\$[A-Za-z][A-Za-z0-9_-]*$/).optional(),
  near: id.optional(), after: id.optional(), in: id.optional(),
  side: z.enum(['right', 'left', 'top', 'bottom']).optional(),
  width: z.number().finite().positive().max(4096).default(280), color: CanvasColorSchema.optional(),
};
export const CanvasArrangeOptionsSchema = z.object({
  algorithm: z.enum(['tree', 'grid', 'layered']).default('tree'),
  elementIds: z.array(id).min(1).optional(), direction: z.enum(['right', 'down']).default('right'),
  columns: z.number().int().min(1).max(100).optional(),
}).strict();
export const CanvasCliOperationSchema = z.union([
  z.object({ ...placement, op: z.literal('add'), type: z.literal('text').default('text'), text: z.string() }).strict(),
  z.object({ ...placement, op: z.literal('add'), type: z.literal('document'), document: z.string().startsWith('workspace:') }).strict(),
  z.object({ ...placement, op: z.literal('add'), type: z.literal('image'), file: z.string().min(1), caption: z.string().default(''), alt: z.string().default('') }).strict(),
  z.object({ op: z.literal('update'), id, revision: z.number().int().positive(), text: z.string().optional(), append: z.string().optional(),
    color: CanvasColorSchema.optional(), locked: z.boolean().optional(), width: z.number().finite().positive().max(4096).optional(),
    caption: z.string().optional(), alt: z.string().optional(), label: z.string().optional(),
  }).strict().refine(value => value.text === undefined || value.append === undefined, 'text 与 append 不能同时使用')
    .refine(value => Object.keys(value).some(key => !['op', 'id', 'revision'].includes(key)), '至少给出一个要修改的字段'),
  z.object({ op: z.literal('delete'), id, revision: z.number().int().positive().optional() }).strict(),
  z.object({ op: z.literal('connect'), ref: placement.ref, from: id, to: id, label: z.string().default(''), direction: z.enum(['none', 'forward', 'both']).default('forward'),
    lineStyle: z.enum(['curve', 'straight']).default('curve'), linePattern: z.enum(['solid', 'dashed']).default('solid'),
  }).strict(),
  z.object({ op: z.literal('disconnect'), id: z.string().regex(/^e[1-9]\d*$/), revision: z.number().int().positive().optional() }).strict(),
  CanvasArrangeOptionsSchema.extend({ op: z.literal('arrange') }),
]);
export const CanvasCliBatchSchema = z.array(CanvasCliOperationSchema).min(1).max(500)
  .refine(operations => operations.filter(operation => operation.op === 'arrange').length <= 1, '每批最多一次 arrange')
  .refine(operations => operations.every((operation, index) => operation.op !== 'arrange' || index === operations.length - 1), 'arrange 必须是批次最后一步');
export type CanvasCliOperation = z.infer<typeof CanvasCliOperationSchema>;
export type CanvasArrangeOptions = z.infer<typeof CanvasArrangeOptionsSchema>;
