// 直接 namespace import 才能让构建器裁剪未用 API 与语言包，避免 Backend/Worker 重复膨胀。
import * as z from 'zod';

/** 坐标相对于整个 chart 外框；plot 为不含轴标签的 inner plot。 */
export const chartLayoutBoxSchema = z.object({
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  w: z.number().finite().positive().max(1), h: z.number().finite().positive().max(1),
}).strict().refine(box => box.x + box.w <= 1 && box.y + box.h <= 1);

export const resolvedChartLayoutSchema = z.object({
  plot: chartLayoutBoxSchema,
  legend: z.object({
    box: chartLayoutBoxSchema,
    orient: z.enum(['horizontal', 'vertical']),
    lines: z.array(z.array(z.string()).min(1)).min(1),
  }).strict().optional(),
  /** 轴线到轴标题中心的距离，单位 inches。 */
  categoryTitleGap: z.number().finite().nonnegative(),
  valueTitleGap: z.number().finite().nonnegative(),
}).strict();

export type ChartLayoutBox = z.infer<typeof chartLayoutBoxSchema>;
export type ResolvedChartLayout = z.infer<typeof resolvedChartLayoutSchema>;
