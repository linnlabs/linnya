import type { ToolContext } from '@plugin/backend/toolRuntime';
import type {
  PresentationInspectTargetResolver,
  PresentationToolCoordinatorPort,
} from './types';

export type PresentationCoordinatorProvider = () => PresentationToolCoordinatorPort;
export type PresentationCoordinatorProviderFactory = (
  context: ToolContext,
) => PresentationCoordinatorProvider;
export type PresentationInspectTargetResolverFactory = (
  context: ToolContext,
) => PresentationInspectTargetResolver;

interface PresentationToolContextBinding {
  readonly coordinator?: PresentationToolCoordinatorPort;
  readonly provider?: PresentationCoordinatorProvider;
  readonly providerFactory?: PresentationCoordinatorProviderFactory;
  readonly inspectTargetResolver?: PresentationInspectTargetResolver;
  readonly inspectTargetResolverFactory?: PresentationInspectTargetResolverFactory;
}

// 5BB 迁移过渡：Slides 工具的 coordinator 绑定归属插件工具层。
// presentation tools 完全迁包后，这层会随包内 factory 一起收口，旧 host re-export 可删除。
const presentationToolContextBindings = new WeakMap<object, PresentationToolContextBinding>();

export function attachPresentationCoordinatorToToolContext<TContext extends ToolContext>(
  context: TContext,
  coordinator: PresentationToolCoordinatorPort,
): TContext {
  presentationToolContextBindings.set(context, {
    ...presentationToolContextBindings.get(context),
    coordinator,
  });
  return context;
}

export function attachPresentationCoordinatorProviderToToolContext<TContext extends ToolContext>(
  context: TContext,
  provider: PresentationCoordinatorProvider,
  providerFactory?: PresentationCoordinatorProviderFactory,
): TContext {
  presentationToolContextBindings.set(context, {
    ...presentationToolContextBindings.get(context),
    provider,
    providerFactory,
  });
  return context;
}

export function attachPresentationInspectTargetResolverToToolContext<TContext extends ToolContext>(
  context: TContext,
  resolver: PresentationInspectTargetResolver,
  resolverFactory?: PresentationInspectTargetResolverFactory,
): TContext {
  presentationToolContextBindings.set(context, {
    ...presentationToolContextBindings.get(context),
    inspectTargetResolver: resolver,
    inspectTargetResolverFactory: resolverFactory,
  });
  return context;
}

export function readPresentationCoordinatorFromToolContext(
  context: object,
): PresentationToolCoordinatorPort | undefined {
  const binding = presentationToolContextBindings.get(context);
  return binding?.coordinator ?? binding?.provider?.();
}

export function readPresentationInspectTargetResolverFromToolContext(
  context: object,
): PresentationInspectTargetResolver | undefined {
  return presentationToolContextBindings.get(context)?.inspectTargetResolver;
}

export function copyPresentationCoordinatorBindingToToolContext(
  source: ToolContext,
  target: ToolContext,
): ToolContext {
  const binding = presentationToolContextBindings.get(source);
  if (binding) {
    presentationToolContextBindings.set(target, {
      coordinator: binding.coordinator,
      provider: binding.providerFactory
        ? binding.providerFactory(target)
        : binding.provider,
      providerFactory: binding.providerFactory,
      inspectTargetResolver: binding.inspectTargetResolverFactory
        ? binding.inspectTargetResolverFactory(target)
        : binding.inspectTargetResolver,
      inspectTargetResolverFactory: binding.inspectTargetResolverFactory,
    });
  }
  return target;
}
