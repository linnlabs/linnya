/** 文本 run 的主导脚本；与平台字体解析入口的稳定值域保持一致。 */
export type TextFontScript = 'latin' | 'eastAsian' | 'complex';

/**
 * 字体解析状态。
 * `not-ready` 与 `unresolved` 不能混作字体族参与一致性统计，否则会把临时目录状态
 * 或缺失字体误报成“使用了第三种字体”。
 */
export type TextFontResolutionKind = 'not-ready' | 'exact' | 'substituted' | 'unresolved';

/** 字体文件内容 + face 身份的 SHA-256；安全审计只暴露该值，不暴露本机路径。 */
export type TextFontFaceFingerprint = string;
