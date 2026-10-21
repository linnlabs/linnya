import { z } from 'zod';

/** 字符按 Unicode code point 计，包含空白和标点；汉字按 Unicode Script=Han 计。 */
export const TextCharacterMetricsSchema = z
  .object({
    characters: z.number().int().nonnegative(),
    han_characters: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (metrics.han_characters > metrics.characters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['han_characters'],
        message: 'han_characters must not exceed characters',
      });
    }
  });

/** 源窗口与完整源文本分开，不含工具行号、分页提示或来源附录。 */
export const TextReadMetricsSchema = z
  .object({
    window: TextCharacterMetricsSchema,
    full_text: TextCharacterMetricsSchema,
  })
  .strict();

export type TextCharacterMetrics = z.infer<typeof TextCharacterMetricsSchema>;
export type TextReadMetrics = z.infer<typeof TextReadMetricsSchema>;
