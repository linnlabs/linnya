import { decorateResearchToolContext, enforceResearchRetrievalScope } from '../../adapters/research-execution/decorateResearchToolContext';
import { decorateDeepWebSnapshotToolContext } from '../../adapters/tools/deepWebSnapshotToolContextDecorator';
import type { PluginBackendContribution } from '../types';
import { PLATFORM_PLUGIN_META } from './platform-meta';
import { legacyBuiltinToolClasses } from '../../adapters/tools/legacyToolClasses';
import { legacyBuiltinAgentDefinitions } from '../../agent-registry/agents/legacyAgentDefinitions';
import { PLATFORM_SUBAGENT_TYPES } from '../subagentTypeRegistry';
import {
  configureDefaultTextMeasurementRuntime,
  resetDefaultTextMeasurementRuntime,
} from '../../../../features/text-measurement/orchestration/configureDefaultTextMeasurementRuntime';
import { getBackendTextMeasurementRuntimeDependencies } from '../../desktop-capabilities';
import {
  configureDefaultSystemFontResolution,
  resetDefaultSystemFontResolution,
} from '../../../../features/font-resolution/orchestration/configureDefaultSystemFontResolution';
import {
  CITATION_PRODUCER_TOOL_NAMES,
  decorateCitationSequenceToolContext,
} from '../../adapters/tools/citationSequenceToolContextDecorator';
import {
  CITATION_REF_ALLOCATOR_TOOL_NAMES,
  decorateCitationRefAllocatorToolContext,
} from '../../adapters/tools/citationRefAllocatorToolContextDecorator';
import {
  DOCUMENT_CITATION_WRITE_TOOL_NAMES,
  decorateDocumentCitationWriteToolContext,
} from '../../adapters/tools/documentCitationWriteToolContextDecorator';
import {
  WEB_EVIDENCE_PRODUCER_TOOL_NAMES,
  decorateWebEvidenceWriterToolContext,
} from '../../adapters/tools/webEvidenceWriterToolContextDecorator';

export const platformBackendPlugin: PluginBackendContribution = {
  meta: PLATFORM_PLUGIN_META,
  toolClasses: legacyBuiltinToolClasses,
  hostOnlyToolNames: ['research_run'],
  toolContextDecorators: [
    { toolNames: ['research_run'], decorate: decorateResearchToolContext },
    { toolNames: ['web_search', 'web_read', 'search_web', 'knowledge_search', 'knowledge_read'], decorate: enforceResearchRetrievalScope },
    { toolNames: ['assemble_web_sources'], decorate: decorateDeepWebSnapshotToolContext },
    {
      toolNames: CITATION_PRODUCER_TOOL_NAMES,
      decorate: decorateCitationSequenceToolContext,
    },
    {
      toolNames: CITATION_REF_ALLOCATOR_TOOL_NAMES,
      decorate: decorateCitationRefAllocatorToolContext,
    },
    {
      toolNames: DOCUMENT_CITATION_WRITE_TOOL_NAMES,
      decorate: decorateDocumentCitationWriteToolContext,
    },
    {
      toolNames: WEB_EVIDENCE_PRODUCER_TOOL_NAMES,
      decorate: decorateWebEvidenceWriterToolContext,
    },
  ],
  agentDefinitions: legacyBuiltinAgentDefinitions,
  subagentTypes: PLATFORM_SUBAGENT_TYPES,
  runtimeEffects: [
    {
      id: 'text-measurement',
      activate: () => configureDefaultTextMeasurementRuntime(
        getBackendTextMeasurementRuntimeDependencies(),
      ),
      deactivate: resetDefaultTextMeasurementRuntime,
    },
    {
      id: 'font-resolution',
      activate: configureDefaultSystemFontResolution,
      deactivate: resetDefaultSystemFontResolution,
    },
  ],
};
