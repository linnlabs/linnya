/**
 * @file src/app-hosts/linnya/agent-registry/prompt.types.ts
 *
 * @description
 * 提示词模板的类型定义。
 *
 * 内置 PromptKeys 仍由 @app/schemas 提供；PromptKey 类型在 host registry 边界放宽为 string。
 * 这样 API wire contract 与插件贡献都不需要修改全局 schema 才能接入新 key。
 */

import { z } from 'zod';

// 唯一真源转发：所有 key 定义来自 @app/schemas
//
// 中文说明：
// - 这里不能用 `export { X } from '@app/schemas'` 直接转发：
//   在 tsx/ESM loader 场景下，@app/schemas（CJS）会导致 re-export 触发 “does not provide an export named …”。
// - 使用 namespace import 做一次显式转发，保证 Node/tsx 都能稳定运行，同时保持“单一真源”。
import * as schemas from '@app/schemas';

export const PromptKeys = schemas.PromptKeys;
export const PROMPT_KEY_VALUES = schemas.PROMPT_KEY_VALUES;
export type PromptKey = string;

export enum PromptType {
  AGENT = 'agent',
  CHAT = 'chat',
  INTERNAL = 'internal',
}

export interface PromptTemplate {
  id: PromptKey;
  type: PromptType;
  content: string;
  description?: string;
  variables?: string[];
}

export const PromptTemplateSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(PromptType),
  content: z.string(),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

export type TemplateVariables = Record<string, string | number | boolean | undefined>;
