import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import type { TemplateSpec } from '@plugin/slides/shared';
import { PresentationRepository } from './repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema';

function makeTemplateSpec(overrides: Partial<TemplateSpec> = {}): TemplateSpec {
  return {
    id: overrides.id ?? 'tpl-1',
    name: overrides.name ?? 'Test Template',
    description: overrides.description,
    theme: overrides.theme ?? {
      colors: { accent1: '#4472C4' },
      fonts: { major: 'Calibri Light', minor: 'Calibri' },
    },
    layouts: overrides.layouts ?? ['Title Slide', 'Blank'],
    masters: overrides.masters ?? ['Office Theme'],
  };
}

describe('PresentationRepository — template methods', () => {
  let db: Database.Database;
  let repo: PresentationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const ddl of PRESENTATION_DOCUMENT_SCHEMAS) {
      db.exec(ddl);
    }
    repo = new PresentationRepository(db);
  });

  // ─── saveTemplate ─────────────────────────────────────────────────────

  it('saves a template and returns its id', async () => {
    const spec = makeTemplateSpec();
    const buf = Buffer.from('fake-pptx');
    const id = await repo.saveTemplate(spec, buf);
    expect(id).toBe('tpl-1');
  });

  // ─── getTemplate ──────────────────────────────────────────────────────

  it('retrieves a saved template', async () => {
    const spec = makeTemplateSpec({ description: 'A nice template' });
    const buf = Buffer.from('fake-pptx-data');
    await repo.saveTemplate(spec, buf);

    const record = await repo.getTemplate('tpl-1');
    expect(record).not.toBeNull();
    expect(record!.id).toBe('tpl-1');
    expect(record!.name).toBe('Test Template');
    expect(record!.description).toBe('A nice template');
    expect(record!.spec.theme.fonts?.major).toBe('Calibri Light');
    expect(record!.spec.layouts).toEqual(['Title Slide', 'Blank']);
    expect(record!.sourcePptxBuffer.toString()).toBe('fake-pptx-data');
    expect(record!.usageCount).toBe(0);
  });

  it('returns null for non-existent template', async () => {
    const record = await repo.getTemplate('does-not-exist');
    expect(record).toBeNull();
  });

  // ─── listTemplates ────────────────────────────────────────────────────

  it('lists all saved templates', async () => {
    await repo.saveTemplate(makeTemplateSpec({ id: 'tpl-a', name: 'Alpha' }), Buffer.from('a'));
    await repo.saveTemplate(makeTemplateSpec({ id: 'tpl-b', name: 'Beta' }), Buffer.from('b'));

    const list = await repo.listTemplates();
    expect(list).toHaveLength(2);
    const names = list.map((t) => t.name).sort();
    expect(names).toEqual(['Alpha', 'Beta']);
  });

  it('returns empty array when no templates exist', async () => {
    const list = await repo.listTemplates();
    expect(list).toEqual([]);
  });

  // ─── incrementTemplateUsage ───────────────────────────────────────────

  it('increments usage count', async () => {
    await repo.saveTemplate(makeTemplateSpec(), Buffer.from('x'));

    await repo.incrementTemplateUsage('tpl-1');
    await repo.incrementTemplateUsage('tpl-1');

    const record = await repo.getTemplate('tpl-1');
    expect(record!.usageCount).toBe(2);
  });
});
