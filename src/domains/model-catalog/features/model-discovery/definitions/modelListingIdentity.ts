import { z } from 'zod';

export const ModelListingIdentityResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1),
      display_name: z.string().trim().min(1).optional(),
    })
  ),
});

/** 只确认列表成员，不附加模型名推断或容量默认值。 */
export type ModelListingIdentity = z.infer<
  typeof ModelListingIdentityResponseSchema
>['data'][number];
