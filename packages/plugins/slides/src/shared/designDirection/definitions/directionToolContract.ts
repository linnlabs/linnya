import * as z from 'zod';
import {
  COLOR_LOGIC_IDS,
  DIRECTION_BOLDNESS,
  DIRECTION_FAMILIES,
  DIRECTION_SCENARIOS,
  DirectionDrawRequestSchema,
  IMAGE_STRATEGY_IDS,
  TYPE_STRATEGY_IDS,
} from './directionContract';

/** ppt_direction 的正式参数就是发方向请求本身。 */
export const PptDirectionToolArgsSchema = DirectionDrawRequestSchema;
export type PptDirectionToolArgs = z.infer<typeof PptDirectionToolArgsSchema>;

/** 工具卡与基准共用的轻量结果：只放身份与各轴取值，说明文字在 observation 里。 */
export const PptDirectionToolDataSchema = z.object({
  drawId: z.string().trim().min(1),
  poolVersion: z.string().trim().min(1),
  scenario: z.enum(DIRECTION_SCENARIOS),
  boldness: z.enum(DIRECTION_BOLDNESS),
  card: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    family: z.enum(DIRECTION_FAMILIES),
  }).strict(),
  colorLogic: z.enum(COLOR_LOGIC_IDS),
  hueBin: z.number().int().min(0).max(11).nullable(),
  typeStrategy: z.enum(TYPE_STRATEGY_IDS),
  imageStrategy: z.enum(IMAGE_STRATEGY_IDS),
  motif: z.string().trim().min(1).nullable(),
  rejectedCardIds: z.array(z.string().trim().min(1)),
}).strict();
export type PptDirectionToolData = z.infer<typeof PptDirectionToolDataSchema>;

export const PptDirectionToolResultSchema = z.object({
  data: PptDirectionToolDataSchema,
  observation: z.string().trim().min(1),
}).strict();
export type PptDirectionToolResult = z.infer<typeof PptDirectionToolResultSchema>;
