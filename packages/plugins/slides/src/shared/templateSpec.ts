/**
 * 模板类型定义
 */

import type { ThemeSpec } from './visual';

export interface TemplateSpec {
  id: string;
  name: string;
  description?: string;
  theme: ThemeSpec;
  layouts: string[]; // layout names
  masters: string[]; // master names
}

export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  usageCount: number;
  createdAt: number;
}
