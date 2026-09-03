import { describe, expect, it } from 'vitest';
import { buildDocumentTypeUnavailableMessage } from './documentTypeUnavailablePresentation';
import type { DocumentNodeTypeAvailability } from '../registry';

const message = {
  disabled: ({ documentType, pluginName }: { documentType: string; pluginName: string }) =>
    `${documentType}/${pluginName}/disabled`,
  missing: ({ documentType, pluginName }: { documentType: string; pluginName: string }) =>
    `${documentType}/${pluginName}/missing`,
  loadFailed: ({ documentType, pluginName }: { documentType: string; pluginName: string }) =>
    `${documentType}/${pluginName}/loadFailed`,
  unknown: ({ nodeType }: { nodeType: string }) => `${nodeType}/unknown`,
  fallback: () => 'fallback',
};

describe('documentTypeUnavailablePresentation', () => {
  it('builds disabled plugin message through injected resolver', () => {
    const availability: DocumentNodeTypeAvailability = {
      state: 'disabled',
      nodeType: 'mindmap',
      pluginId: 'mindmap',
      pluginName: 'Mindmap',
      label: 'Mind map',
    };

    expect(buildDocumentTypeUnavailableMessage(availability, message))
      .toBe('Mind map/Mindmap/disabled');
  });

  it('builds unknown node type message through injected resolver', () => {
    const availability: DocumentNodeTypeAvailability = {
      state: 'unknown',
      nodeType: 'unknown-node',
    };

    expect(buildDocumentTypeUnavailableMessage(availability, message))
      .toBe('unknown-node/unknown');
  });
});
