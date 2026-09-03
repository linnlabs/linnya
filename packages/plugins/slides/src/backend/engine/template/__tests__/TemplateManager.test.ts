import { describe, expect, it } from 'vitest';
import { TemplateManager } from '../TemplateManager.js';
import type { PresentationInfo } from '@plugin/slides/shared';
import type { PptxReaderPort, TemplateRepositoryPort } from '../../types';
import type {
  TemplateSpec,
  TemplateSummary,
} from '@plugin/slides/shared';

function makePresentationInfo(): PresentationInfo {
  return {
    slideCount: 1,
    slideSize: { width: 10, height: 5.625 },
    slides: [],
    theme: {
      colors: {
        accent1: '#123456',
        accent2: '#234567',
        accent3: '#345678',
        lt1: '#F8FAFC',
        lt2: '#CBD5E1',
        dk1: '#0F172A',
      },
      fonts: {
        major: 'Aptos Display',
        minor: 'Aptos',
      },
    },
    masters: [
      { name: 'Main Master', layouts: ['Title Slide', 'Blank'] },
    ],
  };
}

function createReader(info: PresentationInfo): PptxReaderPort {
  return {
    async parse() {
      return info;
    },
  };
}

function createRepository(): TemplateRepositoryPort {
  const templates = new Map<string, TemplateSpec>();
  return {
    async saveTemplate(template) {
      templates.set(template.id, template);
      return template.id;
    },
    async getTemplate(templateId) {
      const spec = templates.get(templateId);
      if (!spec) return null;
      return {
        id: spec.id,
        name: spec.name,
        description: spec.description,
        spec,
        sourcePptxBuffer: Buffer.from('pptx'),
        createdAt: 1,
        updatedAt: 1,
        usageCount: 0,
      };
    },
    async listTemplates(): Promise<TemplateSummary[]> {
      return Array.from(templates.values()).map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        usageCount: 0,
        createdAt: 1,
      }));
    },
  };
}

describe('TemplateManager', () => {
  it('persists the imported theme and master metadata', async () => {
    const info = makePresentationInfo();
    const manager = new TemplateManager(createReader(info), createRepository());
    const buffer = Buffer.from('pptx');

    const result = await manager.importFromPptx(buffer, 'Imported Theme');

    expect(result).toMatchObject({
      name: 'Imported Theme',
      theme: info.theme,
      layouts: ['Title Slide', 'Blank'],
      masters: ['Main Master'],
    });
  });
});
