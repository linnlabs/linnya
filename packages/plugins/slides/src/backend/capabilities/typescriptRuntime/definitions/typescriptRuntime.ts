import type ts from 'typescript';

/** Slides backend 实际使用的 TypeScript 编译器运行时。类型导入会在构建时擦除。 */
export type SlidesTypeScriptRuntime = typeof ts;

/** CJS 加载边界始终先返回 unknown，再由运行时合同校验。 */
export type SlidesTypeScriptRuntimeRequire = (id: string) => unknown;

export type SlidesTypeScriptCreateRequire = (
  filename: string | URL
) => SlidesTypeScriptRuntimeRequire;
