import type { AgentContextBuilderConfig } from '../config';
import {
  BaseContextProvider as SharedBaseContextProvider,
  type IContextProvider as SharedIContextProvider,
  type ProviderContext as SharedProviderContext,
} from '../../../../shared/providers/base';

export type {
  MessageProcessingState,
  ProviderResult,
} from '../../../../shared/providers/base';

export type ProviderContext = SharedProviderContext<AgentContextBuilderConfig>;
export type IContextProvider = SharedIContextProvider<AgentContextBuilderConfig>;
export abstract class BaseContextProvider
  extends SharedBaseContextProvider<AgentContextBuilderConfig>
  implements IContextProvider {}
