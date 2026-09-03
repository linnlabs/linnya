/**
 * @file fontResolution.ts
 * @description 后端插件消费平台字体解析/替换能力的窄门面。
 *
 * 中文说明：
 * - 字体解析是平台排版能力，不属于任何具体插件私有实现；
 * - 后端插件只能通过这个 SDK 消费，避免直接 import host 的
 *   `src/features/font-resolution` 内部路径。
 */

export {
  classifyDominantScript,
  collectRequiredGlyphCodePoints,
  checkFontFamily,
  createSystemFontCatalogQueryRuntime,
  createSystemFontResolutionRuntime,
  FontCatalogUnavailableError,
  listFontFamilies,
  resolveFont,
} from 'src/features/font-resolution';

export type {
  FontMetadata as PluginFontMetadata,
  FontFamilyCandidate as PluginFontFamilyCandidate,
  FontFamilyCheckResult as PluginFontFamilyCheckResult,
  FontFamilyListRequest as PluginFontFamilyListRequest,
  FontFamilyListResult as PluginFontFamilyListResult,
  FontFamilyStyle,
  FontRequest as PluginFontRequest,
  FontResolutionKind as PluginFontResolutionKind,
  ResolvedFont as PluginResolvedFont,
  ScriptClass,
  SystemFontCatalogQueryRuntime as PluginSystemFontCatalogQueryRuntime,
  SystemFontResolutionRuntime as PluginSystemFontResolutionRuntime,
} from 'src/features/font-resolution';
