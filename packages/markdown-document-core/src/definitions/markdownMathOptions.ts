import type { KatexOptions } from 'katex';

// 所有正文公式共用信任/错误策略；TeX 不授予 HTML 或链接执行权限。
export const markdownMathOptions: KatexOptions = { throwOnError: false, trust: false, strict: 'ignore' };
