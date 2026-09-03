import { describe, expect, it } from 'vitest';
import { ConversationAgentIds } from '@app/schemas';
import {
  resolveConversationAgentChoiceTextPresentation,
  resolveDocumentTypeTextPresentation,
} from './pluginContributionPresentation';

const TestComponent = { name: 'PluginContributionPresentationTest' };

describe('pluginContributionPresentation', () => {
  it('resolves document type localized text when present', () => {
    const presentation = resolveDocumentTypeTextPresentation({
      pluginId: 'test',
      nodeType: 'document',
      activeDocumentType: 'editor',
      createRequestType: 'document',
      createBackend: 'workspace-document',
      surfaceComponent: TestComponent,
      label: 'Document',
      createLabel: 'New document',
      defaultName: 'Untitled document',
      labelText: { key: 'document.label', fallback: 'Fallback document' },
      createLabelText: { key: 'document.create', fallback: 'Fallback create' },
      defaultNameText: { key: 'document.defaultName', fallback: 'Fallback name' },
      iconComponent: TestComponent,
      iconClass: 'file-icon',
      createPriority: 10,
      entityReferences: [{
        kind: 'document',
        uriPattern: 'linnya://test/document/{documentId}',
        description: 'Test document.',
      }],
    }, (text) => (typeof text === 'string' ? text : `resolved:${text.key}`));

    expect(presentation).toEqual({
      label: 'resolved:document.label',
      createLabel: 'resolved:document.create',
      defaultName: 'resolved:document.defaultName',
    });
  });

  it('keeps legacy document type strings as fallback contract', () => {
    const presentation = resolveDocumentTypeTextPresentation({
      pluginId: 'test',
      nodeType: 'sheet',
      activeDocumentType: 'sheet',
      createRequestType: 'sheet',
      createBackend: 'workspace-document',
      surfaceComponent: TestComponent,
      label: 'Spreadsheet',
      createLabel: 'New spreadsheet',
      defaultName: 'Untitled spreadsheet',
      iconComponent: TestComponent,
      iconClass: 'sheet-icon',
      createPriority: 20,
      entityReferences: [{
        kind: 'workbook',
        uriPattern: 'linnya://test/sheet/{documentId}',
        description: 'Test workbook.',
      }],
    }, (text) => (typeof text === 'string' ? text : text.fallback));

    expect(presentation).toEqual({
      label: 'Spreadsheet',
      createLabel: 'New spreadsheet',
      defaultName: 'Untitled spreadsheet',
    });
  });

  it('resolves conversation agent choice localized text when present', () => {
    const presentation = resolveConversationAgentChoiceTextPresentation({
      id: 'deep_research',
      agentId: ConversationAgentIds.DEEP_RESEARCH,
      menuText: 'Deep research',
      pillText: 'Research',
      ariaLabel: 'Enabled: Deep research',
      menuLocalizedText: { key: 'workflow.menu', fallback: 'Fallback menu' },
      pillLocalizedText: { key: 'workflow.pill', fallback: 'Fallback pill' },
      ariaLocalizedText: { key: 'workflow.aria', fallback: 'Fallback aria' },
      iconComponent: TestComponent,
    }, (text) => (typeof text === 'string' ? text : `resolved:${text.key}`));

    expect(presentation).toEqual({
      menuText: 'resolved:workflow.menu',
      pillText: 'resolved:workflow.pill',
      ariaLabel: 'resolved:workflow.aria',
    });
  });
});
