/**
 * TemplateManager
 *
 * 模板管理：导入、存储、检索模板
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  TemplateSpec,
  TemplateSummary,
  ThemeSpec,
} from '@plugin/slides/shared';
import type { PptxReaderPort, TemplateRepositoryPort } from '../types';

export class TemplateManager {
  constructor(
    private readonly pptxReader: PptxReaderPort,
    private readonly templateRepo: TemplateRepositoryPort,
  ) {}

  /** 从 PPTX 导入模板 */
  async importFromPptx(buffer: Buffer, name: string, description?: string): Promise<TemplateSpec> {
    // 1. 解析 PPTX 结构
    const info = await this.pptxReader.parse(buffer);

    // 2. 从 PresentationInfo 归纳出 TemplateSpec
    const templateSpec: TemplateSpec = {
      id: uuidv4(),
      name,
      description,
      theme: {
        colors: info.theme.colors,
        fonts: info.theme.fonts,
        chart: info.theme.chart,
      },
      layouts: info.masters.flatMap((m) => m.layouts),
      masters: info.masters.map((m) => m.name),
    };

    // 3. 持久化
    await this.templateRepo.saveTemplate(templateSpec, buffer);

    return templateSpec;
  }

  /** 获取模板主题 */
  async getTheme(templateId: string): Promise<ThemeSpec | null> {
    const record = await this.templateRepo.getTemplate(templateId);
    if (!record) return null;
    return record.spec.theme;
  }

  /** 列出所有模板 */
  async listTemplates(): Promise<TemplateSummary[]> {
    return this.templateRepo.listTemplates();
  }

  /** 获取模板（含 sourcePptxBuffer） */
  async getTemplate(templateId: string) {
    return this.templateRepo.getTemplate(templateId);
  }
}
