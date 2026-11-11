import { z } from 'zod';
import { HttpCitationUrlSchema } from '../citation';
import { WebFailureKindSchema } from './web-common';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

/** 免 key 的开放图片来源。Openverse 聚合 Flickr、Europeana、各博物馆等，与 Commons 重复的部分由 Commons 直接提供。 */
export const IMAGE_SEARCH_SOURCES = ['wikimedia_commons', 'openverse'] as const;
export const ImageSearchSourceSchema = z.enum(IMAGE_SEARCH_SOURCES);
export type ImageSearchSource = z.infer<typeof ImageSearchSourceSchema>;

export const IMAGE_SEARCH_DEFAULT_RESULTS = 12;
export const IMAGE_SEARCH_MAX_RESULTS = 20;
export const IMAGE_SEARCH_QUERY_MAX_CHARS = 200;

export const ImageSearchArgsSchema = z.object({
  query: z.string().trim().min(1).max(IMAGE_SEARCH_QUERY_MAX_CHARS),
  /** 缺省两个来源都查。 */
  source: ImageSearchSourceSchema.optional(),
  /** 只要许可允许商用的图（排除 NC 和条款不明的）。 */
  commercial_only: z.boolean().optional(),
  max_results: z.number().int().min(1).max(IMAGE_SEARCH_MAX_RESULTS).optional(),
}).strict();
export type ImageSearchArgs = z.infer<typeof ImageSearchArgsSchema>;

/**
 * 许可代码按 Creative Commons 归一；`other` 是来源给出但不属于 CC 族的条款（GFDL、FAL、各馆自定条款等），
 * 名称原样保留，是否可商用按保守判断为否，需看来源页。
 */
export const IMAGE_LICENSE_CODES = [
  'cc0', 'pdm', 'by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd', 'other',
] as const;
export const ImageLicenseCodeSchema = z.enum(IMAGE_LICENSE_CODES);
export type ImageLicenseCode = z.infer<typeof ImageLicenseCodeSchema>;

export const ImageLicenseSchema = z.object({
  code: ImageLicenseCodeSchema,
  /** 来源给出的许可名称，如 "CC BY-SA 3.0"、"Public domain"。 */
  name: NonEmptyStringSchema.max(200),
  url: HttpCitationUrlSchema.optional(),
  /** 许可允许商用（仍须满足署名、相同方式共享等条件）。 */
  commercial_use: z.boolean(),
  /** 许可允许改动（裁切、调色、合成）；ND 为 false。 */
  modifications: z.boolean(),
  /** 许可要求署名。 */
  attribution_required: z.boolean(),
}).strict();
export type ImageLicense = z.infer<typeof ImageLicenseSchema>;

export const ImageSearchCandidateSchema = z.object({
  /** 本次结果内的编号，如 "c3"。 */
  id: z.string().regex(/^c\d{1,2}$/),
  source: ImageSearchSourceSchema,
  /** 实际收藏方或上传站点，如 wikimedia_commons、flickr、met、smithsonian_*。 */
  provider: NonEmptyStringSchema.max(100),
  title: NonEmptyStringSchema.max(300),
  /** 原图地址。 */
  image_url: HttpCitationUrlSchema,
  /** 建议下载的 JPEG/PNG/WebP 地址：原图过大或不是这三种格式时为来源提供的缩放版本。 */
  download_url: HttpCitationUrlSchema,
  /** 来源页（许可、作者和描述的原始出处）。 */
  page_url: HttpCitationUrlSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  download_width: z.number().int().positive().optional(),
  creator: NonEmptyStringSchema.max(300).optional(),
  description: NonEmptyStringSchema.max(500).optional(),
  license: ImageLicenseSchema,
  /** 按许可写好的署名文字，可直接放进致谢或备注。 */
  attribution: NonEmptyStringSchema.max(600),
}).strict();
export type ImageSearchCandidate = z.infer<typeof ImageSearchCandidateSchema>;

export const ImageSearchSourceStatusSchema = z.object({
  source: ImageSearchSourceSchema,
  status: z.enum(['ok', 'failed']),
  result_count: z.number().int().nonnegative(),
  error_kind: WebFailureKindSchema.optional(),
}).strict();
export type ImageSearchSourceStatus = z.infer<typeof ImageSearchSourceStatusSchema>;

export const ImageSearchResultSchema = z.object({
  data: z.object({
    query: NonEmptyStringSchema,
    commercial_only: z.boolean(),
    candidates: z.array(ImageSearchCandidateSchema).max(IMAGE_SEARCH_MAX_RESULTS),
    sources: z.array(ImageSearchSourceStatusSchema).min(1).max(IMAGE_SEARCH_SOURCES.length),
  }).strict().superRefine((data, context) => {
    const ids = new Set<string>();
    for (const [index, candidate] of data.candidates.entries()) {
      if (ids.has(candidate.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates', index, 'id'], message: 'Candidate ids must be unique' });
      }
      ids.add(candidate.id);
      if (data.commercial_only && !candidate.license.commercial_use) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates', index, 'license'], message: 'commercial_only results must allow commercial use' });
      }
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();
export type ImageSearchResult = z.infer<typeof ImageSearchResultSchema>;
