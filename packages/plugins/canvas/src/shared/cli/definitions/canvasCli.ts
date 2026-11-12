import { z } from 'zod';
import { CanvasColorSchema, CanvasEdgeSchema } from '../../model/definitions/canvasElement';
import {
  CanvasArrangementOptionsSchema,
  CanvasLayoutTargetSchema,
} from '../../layout/definitions/canvasLayout';

export const CANVAS_CLI_VERSION = 1;
const id = z.string().regex(/^(?:[ce][1-9]\d*|\$[A-Za-z][A-Za-z0-9_-]*)$/);
const placement = {
  ref: z
    .string()
    .regex(/^\$[A-Za-z][A-Za-z0-9_-]*$/)
    .optional(),
  near: CanvasLayoutTargetSchema.optional(),
  after: CanvasLayoutTargetSchema.optional(),
  in: CanvasLayoutTargetSchema.optional(),
  side: z.enum(['right', 'left', 'top', 'bottom']).optional(),
  width: z.number().finite().positive().max(4096).default(280),
  color: CanvasColorSchema.optional(),
  /** 放进哪个分区（分区 ID 或本批 ref）。 */
  section: CanvasLayoutTargetSchema.optional(),
};
const sectionTitle = z.string().max(200);
export const CanvasArrangeOptionsSchema = CanvasArrangementOptionsSchema;
export const CanvasCliOperationSchema = z.union([
  z
    .object({
      ...placement,
      op: z.literal('add'),
      type: z.literal('text').default('text'),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      ...placement,
      op: z.literal('add'),
      type: z.literal('document'),
      document: z.string().startsWith('workspace:'),
    })
    .strict(),
  z
    .object({
      ...placement,
      op: z.literal('add'),
      type: z.literal('image'),
      file: z.string().min(1),
      caption: z.string().default(''),
      alt: z.string().default(''),
    })
    .strict(),
  z
    .object({
      ...placement,
      op: z.literal('add'),
      type: z.literal('section'),
      title: sectionTitle,
      /** 把已有的卡归进这个新分区；分区围着它们建，卡片不挪位置。 */
      members: z.array(CanvasLayoutTargetSchema).min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      id,
      revision: z.number().int().positive(),
      text: z.string().optional(),
      append: z.string().optional(),
      color: CanvasColorSchema.optional(),
      locked: z.boolean().optional(),
      width: z.number().finite().positive().max(4096).optional(),
      caption: z.string().optional(),
      alt: z.string().optional(),
      /** 分区标题。 */
      title: sectionTitle.optional(),
      /** 移进某分区；null 移出分区。 */
      section: z
        .string()
        .regex(/^c[1-9]\d*$/)
        .nullable()
        .optional(),
      label: z.string().optional(),
      direction: CanvasEdgeSchema.shape.direction.optional(),
      lineStyle: CanvasEdgeSchema.shape.lineStyle.optional(),
      // solid只在新建时缺省；更新未给虚实字段时必须保留现有样式。
      linePattern: CanvasEdgeSchema.shape.linePattern.unwrap().optional(),
    })
    .strict()
    .refine(
      value => value.text === undefined || value.append === undefined,
      'text 与 append 不能同时使用'
    )
    .refine(
      value => Object.keys(value).some(key => !['op', 'id', 'revision'].includes(key)),
      '至少给出一个要修改的字段'
    ),
  z.object({ op: z.literal('delete'), id, revision: z.number().int().positive() }).strict(),
  z
    .object({
      op: z.literal('connect'),
      ref: placement.ref,
      from: CanvasLayoutTargetSchema,
      to: CanvasLayoutTargetSchema,
      label: z.string().default(''),
      direction: CanvasEdgeSchema.shape.direction.default('forward'),
      lineStyle: CanvasEdgeSchema.shape.lineStyle.default('curve'),
      linePattern: CanvasEdgeSchema.shape.linePattern,
    })
    .strict(),
  z
    .object({
      op: z.literal('disconnect'),
      id: z.string().regex(/^e[1-9]\d*$/),
      revision: z.number().int().positive(),
    })
    .strict(),
  CanvasArrangeOptionsSchema.extend({ op: z.literal('arrange') }),
]);
export const CanvasCliBatchSchema = z
  .array(CanvasCliOperationSchema)
  .min(1)
  .max(500)
  .refine(
    operations => operations.filter(operation => operation.op === 'arrange').length <= 1,
    '每批最多一次 arrange'
  )
  .refine(
    operations =>
      operations.every(
        (operation, index) => operation.op !== 'arrange' || index === operations.length - 1
      ),
    'arrange 必须是批次最后一步'
  );
export type CanvasCliOperation = z.infer<typeof CanvasCliOperationSchema>;
export type CanvasArrangeOptions = z.infer<typeof CanvasArrangeOptionsSchema>;
