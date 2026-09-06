import { describe, expect, it } from 'vitest';
import { WORKSPACE_MESSAGE_CATALOG } from '../definitions/workspaceMessageCatalog';
import type { WorkspaceMessageResolver } from '../definitions/workspaceMessages';
import { buildWorkspaceMarkdownSerializerLabels } from './markdownSerializerLabels';

const enCatalog = WORKSPACE_MESSAGE_CATALOG.catalogs['en-US'];
const workspaceMessage: WorkspaceMessageResolver = (key, params) => {
  const template = enCatalog[key];
  if (!params) return template;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  );
};

describe('buildWorkspaceMarkdownSerializerLabels', () => {
  it('builds localized labels for markdown export placeholders', () => {
    const labels = buildWorkspaceMarkdownSerializerLabels(workspaceMessage);

    expect(labels.bibliographyTitle).toBe('References');
    expect(labels.imageAlt).toBe('Image');
    expect(labels.imageDescription({ alt: 'Demo' })).toBe('[Image: Demo]');
    expect(labels.imageDescription({ alt: 'Demo', width: 320 })).toBe('[Image: Demo, width 320px]');
    expect(labels.imageDescription({ alt: 'Demo', height: 240 })).toBe('[Image: Demo, height 240px]');
    expect(labels.imageDescription({ alt: 'Demo', width: 320, height: 240 })).toBe(
      '[Image: Demo, width 320px, height 240px]',
    );
  });
});
