/**
 * @file src/agent/context-manager/profiles/agent/context/providers/index.ts
 * @description Agent profile provider 协议与实现导出
 */

export * from './base';

export { AgentCoreContextProvider } from './AgentCoreContextProvider';
export { AgentWorkingMemoryProvider } from './AgentWorkingMemoryProvider';
import { ContextProviderRegistry as SharedContextProviderRegistry } from '../../../../shared/providers';
import type { AgentContextBuilderConfig } from '../config';

export class ContextProviderRegistry extends SharedContextProviderRegistry<AgentContextBuilderConfig> {}
