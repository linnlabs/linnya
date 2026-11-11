import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';
import {
  WebCacheStatusSchema,
  WebDocumentWarningSchema,
  WebExtractionFailureStageSchema,
  WebFailureKindSchema,
  WebReadEscalationReasonSchema,
} from './web-common';
import { HistoricalResourceReadArgsSchema } from './resource-read';
import { ImageLicenseSchema } from './image-search';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const WebPageResourceSchema = z.object({
  kind: z.enum(['document', 'doi', 'source']),
  url: HttpCitationUrlSchema,
  label: NonEmptyStringSchema.optional(),
}).strict();
/** 单次返回给模型的正文上限（显式 max_chars 可到此值）。 */
export const WEB_READ_MAX_CONTENT_CHARS = 50_000;
/**
 * 默认单次返回。Host 工具输出预览为 20,000 字符，超出只显示前缀，末尾的续读提示会丢；
 * 留出标题、来源和续读提示的空间。与 read_file 的 PDF 页窗口预算一致。
 */
export const WEB_READ_DEFAULT_RETURN_CHARS = 15_000;
/** 正文快照保存上限：offset / find 在这段全文里读，重读不重新抓取。 */
export const WEB_READ_MAX_CAPTURE_CHARS = 500_000;
export const WEB_READ_FIND_MAX_CHARS = 200;
/** 单文件字节上限由 HTTP 取得、存储回执及历史投影共同遵守；会话总量另由存储拥有。 */
export const WEB_ACQUIRED_FILE_MAX_BYTES = 30 * 1024 * 1024;

/** 文件取得事实，不表示正文、页码或模型解析结果已经核验。路径相对于当前会话 cwd。 */
export const WebAcquiredFileSchema = z.object({
  path: z.string().regex(/^web-downloads\/[a-f0-9]{64}\.(pdf|csv|xlsx|jpg|png|webp)$/),
  format: z.enum(['pdf', 'csv', 'xlsx', 'jpg', 'png', 'webp']),
  mimeType: NonEmptyStringSchema,
  byteLength: z.number().int().positive().max(WEB_ACQUIRED_FILE_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestedUrl: HttpCitationUrlSchema,
  finalUrl: HttpCitationUrlSchema,
  acquiredAt: z.string().datetime(),
  trust: z.literal('untrusted_external_file'),
}).strict().superRefine((file, context) => {
  if (file.path !== `web-downloads/${file.sha256}.${file.format}`) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['path'], message: 'File path must match the acquired hash and format' });
  }
});
export type WebAcquiredFile = z.infer<typeof WebAcquiredFileSchema>;

export const WEB_IMAGE_FILE_FORMATS = ['jpg', 'png', 'webp'] as const;

/**
 * 下载的图片在哪里被看到：image_search 的候选或网页上的图片候选。只陈述当时记下的来源说明，
 * 许可来自来源元数据，未经核验；网页上的图只有图注、署名和页面版权声明原文。
 */
export const WebImageSourceSchema = z.object({
  found_via: z.enum(['image_search', 'web_page']),
  page_url: HttpCitationUrlSchema,
  provider: NonEmptyStringSchema.max(100).optional(),
  title: NonEmptyStringSchema.max(300).optional(),
  creator: NonEmptyStringSchema.max(300).optional(),
  license: ImageLicenseSchema.optional(),
  attribution: NonEmptyStringSchema.max(600).optional(),
  caption: NonEmptyStringSchema.max(500).optional(),
  credit: NonEmptyStringSchema.max(300).optional(),
  page_rights: NonEmptyStringSchema.max(300).optional(),
}).strict();
export type WebImageSource = z.infer<typeof WebImageSourceSchema>;

/** 网页正文里的主要图片：og:image、带图注的 figure 与正文大图。地址未下载、未检查。 */
export const WebPageImageSchema = z.object({
  url: HttpCitationUrlSchema,
  kind: z.enum(['og', 'figure', 'content']),
  alt: NonEmptyStringSchema.max(300).optional(),
  caption: NonEmptyStringSchema.max(500).optional(),
  credit: NonEmptyStringSchema.max(300).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).strict();
export type WebPageImage = z.infer<typeof WebPageImageSchema>;
export const WEB_PAGE_IMAGES_MAX = 8;

/** `17` 或 `15-18`，1-based 闭区间；与 read_file 的 PDF pages 同一写法。 */
const WebReadPdfPagesSchema = z.string().regex(/^[1-9]\d*(?:-[1-9]\d*)?$/u, 'pages must look like "17" or "15-18"');

export const WebReadArgsSchema = z.object({
  url: HttpCitationUrlSchema,
  // 读取编排会把非正数恢复为默认预算，并把正数向下取整、限制到最大预算。
  max_chars: z.number().finite().optional(),
  title_hint: z.string().optional(),
  /** 从已保存正文的第几个字符（UTF-16，0 起）开始返回；用上次结果给出的 next_offset。 */
  offset: z.number().int().nonnegative().optional(),
  /** 在已保存正文（或 PDF 各页文字）里查找，返回命中位置与上下文。 */
  find: z.string().trim().min(1).max(WEB_READ_FIND_MAX_CHARS).optional(),
  /** 仅 PDF：要读的页；与 find 同用时是查找范围。 */
  pages: WebReadPdfPagesSchema.optional(),
}).strict().superRefine((args, context) => {
  if (args.offset !== undefined && args.find !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['offset'], message: 'use offset or find, not both' });
  }
  if (args.pages !== undefined && args.offset !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['offset'], message: 'PDF is read by pages; offset applies to page text only' });
  }
  if (args.pages !== undefined) {
    const [from, to = from] = args.pages.split('-').map(Number);
    if (to! < from!) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'pages range must not run backwards' });
  }
});

/** 历史 resource_read(http/https) 事件的 replay 参数合同。 */
export const HistoricalWebResourceReadArgsSchema = HistoricalResourceReadArgsSchema.extend({
  uri: HttpCitationUrlSchema,
}).strict();

export const WebReadCitationSchema = z.object({
  sourceType: z.literal('web'),
  ref: CitationRefSchema,
  index: z.number().int().positive(),
  url: HttpCitationUrlSchema,
  docTitle: NonEmptyStringSchema,
  snippet: z.string(),
  siteName: NonEmptyStringSchema.optional(),
  publishedAt: NonEmptyStringSchema.optional(),
  author: NonEmptyStringSchema.optional(),
}).strict();

const WebReadDataObjectSchema = z.object({
  url: HttpCitationUrlSchema,
  title: NonEmptyStringSchema,
  charCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  provider: NonEmptyStringSchema,
  renderMode: z.enum(['http', 'js', 'managed']),
  extractor: NonEmptyStringSchema,
  renderAttempted: z.boolean(),
  escalated: z.boolean(),
  escalationReason: WebReadEscalationReasonSchema.optional(),
  initialFailureKind: WebFailureKindSchema.optional(),
  initialFailureStage: WebExtractionFailureStageSchema.optional(),
  /** 提取器启发式信号，不代表来源可信度或全文完整性。 */
  warnings: z.array(WebDocumentWarningSchema).max(8).optional(),
  resources: z.array(WebPageResourceSchema).max(16).optional(),
  /** 网页上的主要图片候选（最多 8 张）与页面版权声明；下载用 web_read 读图片地址。 */
  images: z.array(WebPageImageSchema).max(WEB_PAGE_IMAGES_MAX).optional(),
  page_rights: NonEmptyStringSchema.max(300).optional(),
  /** 仅图片文件：解码后的尺寸与当时记下的来源说明。 */
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    source: WebImageSourceSchema.optional(),
  }).strict().optional(),
  /** 本次返回的是已保存正文的哪一段；缺省表示旧回执（从开头返回）。 */
  window: z.object({
    offset: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    total_chars: z.number().int().nonnegative(),
    next_offset: z.number().int().positive().optional(),
    /** 保存的正文已在快照上限处截断，total_chars 之后还有原文。 */
    capture_truncated: z.boolean(),
  }).strict().optional(),
  find: z.object({
    query: NonEmptyStringSchema,
    hit_count: z.number().int().nonnegative(),
    /** 网页正文的命中偏移（可作 offset 续读）；PDF 给 hit_pages。 */
    hit_offsets: z.array(z.number().int().nonnegative()).max(30).optional(),
    hit_pages: z.array(z.number().int().positive()).optional(),
    truncated: z.boolean(),
  }).strict().optional(),
  /** 仅 PDF：从文字层返回的页。 */
  pdf: z.object({
    page_count: z.number().int().positive(),
    pages: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict(),
    next_pages: z.string().optional(),
    pages_without_text: z.array(z.number().int().positive()),
    complex_layout_pages: z.array(z.number().int().positive()),
  }).strict().optional(),
  file: WebAcquiredFileSchema.optional(),
  citations: z.object({
    query: HttpCitationUrlSchema,
    searchMode: z.literal('web'),
    citations: z.tuple([WebReadCitationSchema]),
  }).strict(),
  evidence_store: z.object({
    bundle_id: NonEmptyStringSchema,
  }).strict(),
  cacheStatus: WebCacheStatusSchema,
}).strict();

function validateWebReadData(
  data: z.infer<typeof WebReadDataObjectSchema>,
  context: z.RefinementCtx,
): void {
  const citation = data.citations.citations[0];
  // PDF 可以带文字层页文字（extractor=pdf_text_layer，并给出 pdf 页范围）；XLSX 不提取正文。
  const pdfText = data.file?.format === 'pdf' && data.extractor === 'pdf_text_layer' && data.pdf !== undefined;
  if (data.file && data.file.format !== 'csv' && !pdfText && (data.charCount !== 0 || data.extractor !== 'file_download')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['file'], message: 'Binary file acquisition cannot claim extracted page text' });
  }
  const imageFile = data.file !== undefined && (WEB_IMAGE_FILE_FORMATS as readonly string[]).includes(data.file.format);
  if ((data.image !== undefined) !== imageFile) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['image'], message: 'Image facts appear exactly when an image file was acquired' });
  }
  if (data.pdf && data.file?.format !== 'pdf') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pdf'], message: 'PDF page text requires an acquired PDF file' });
  }
  if (citation.url !== data.url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations', 'citations', 0, 'url'],
      message: 'web read citation URL must match the canonical result URL',
    });
  }
  if (citation.docTitle !== data.title) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations', 'citations', 0, 'docTitle'],
      message: 'web read citation title must match the result title',
    });
  }
}

const WebReadDataSchema = WebReadDataObjectSchema.superRefine(validateWebReadData);

export const WebReadResultSchema = z.object({
  data: WebReadDataSchema,
  observation: NonEmptyStringSchema,
}).strict();

/** 历史 resource_read(http/https) 事件的 replay 结果合同。 */
export const HistoricalWebResourceReadResultSchema = z.object({
  data: z.object({
    uri: HttpCitationUrlSchema,
    source: z.literal('web'),
    ...WebReadDataObjectSchema.shape,
  }).strict().superRefine(validateWebReadData),
  observation: NonEmptyStringSchema,
}).strict();

export type WebReadArgs = z.infer<typeof WebReadArgsSchema>;
export type WebReadCitation = z.infer<typeof WebReadCitationSchema>;
export type WebReadResult = z.infer<typeof WebReadResultSchema>;
export type HistoricalWebResourceReadResult = z.infer<typeof HistoricalWebResourceReadResultSchema>;
