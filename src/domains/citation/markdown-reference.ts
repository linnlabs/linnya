/**
 * Citation Markdown 引用语法的浏览器安全公共契约。
 *
 * 该入口只暴露纯解析/投影能力，Renderer 不需要依赖 Citation domain 的后端装配入口，
 * 同时避免 Markdown、Conversation、Revision 分别维护一套 `[@ref]` 正则。
 */
export type { MarkdownCitationToken } from './features/document-read/definitions/markdownCitationToken';
export {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  parseMarkdownCitationTokens,
} from './features/document-read/functions/parseMarkdownCitationTokens';
export { projectMarkdownCitationTokens } from './features/document-read/functions/projectMarkdownCitationTokens';
