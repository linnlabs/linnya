import * as z from 'zod';

const finite = z.number().finite();
const length = z.union([finite, z.literal('auto'), z.string().regex(/^-?\d+(?:\.\d+)?%$/)]);
const edges = z.tuple([length.nullable(), length.nullable(), length.nullable(), length.nullable(), length.nullable(), length.nullable(), length.nullable(), length.nullable(), length.nullable()]);

/** Yoga 已归一化的 points 输入；只承载布局，不携带作者源码、绘制样式或资产。 */
export const layoutReplayStyleSchema = z.object({
  width: length.optional(), height: length.optional(),
  minWidth: finite.optional(), minHeight: finite.optional(), maxWidth: finite.optional(), maxHeight: finite.optional(),
  grow: finite, shrink: finite, basis: length.optional(),
  direction: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  positionType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  align: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  justify: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  margin: edges, padding: edges, position: edges, gap: finite.optional(),
}).strict();

export const layoutReplayMeasurementSchema = z.object({ kind: z.literal('text'), content: z.string(), fontSizePt: finite,
    lineSpacingMultiple: finite, letterSpacingPt: finite.optional(), intrinsicWidth: finite,
    // 固有宽度 Text 在原编译中没有 measureFunc；手动设宽后才改为 word 测量。
    wrap: z.enum(['none', 'word']), explicitHeight: z.boolean(),
  }).strict();

export const layoutReplaySchema = z.object({
  nodes: z.array(z.object({ id: z.string().min(1), parent: z.number().int().min(-1), order: z.number().int().nonnegative(),
    style: layoutReplayStyleSchema, measurement: layoutReplayMeasurementSchema.optional(),
  }).strict()).min(1),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>();
  for (const [index, node] of snapshot.nodes.entries()) {
    if (ids.has(node.id) || (index === 0 ? node.parent !== -1 : node.parent < 0 || node.parent >= index)) {
      ctx.addIssue({ code: 'custom', path: ['nodes', index], message: 'Invalid layout replay tree' });
    }
    ids.add(node.id);
  }
});

export type LayoutReplayStyle = z.infer<typeof layoutReplayStyleSchema>;
export type LayoutReplayMeasurement = z.infer<typeof layoutReplayMeasurementSchema>;
export type LayoutReplay = z.infer<typeof layoutReplaySchema>;
