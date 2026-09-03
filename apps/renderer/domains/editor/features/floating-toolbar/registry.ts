
import { TextSelection, AllSelection } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';
import type { ToolbarProvider, ToolbarContext } from './types';

const commonProviders: ToolbarProvider[] = [];
const providersByNodeType = new Map<string, ToolbarProvider[]>();

export function registerCommonToolbarProvider(provider: ToolbarProvider): void {
  if (!commonProviders.some(p => p.name === provider.name)) {
    provider.weight = provider.weight ?? 50;
    commonProviders.push(provider);
    commonProviders.sort((a, b) => (a.weight ?? 50) - (b.weight ?? 50));
  }
}

export function registerBlockToolbarProvider(nodeType: string, provider: ToolbarProvider): void {
  const providers = providersByNodeType.get(nodeType) ?? [];
  if (!providers.some(p => p.name === provider.name)) {
    provider.weight = provider.weight ?? 100;
    providers.push(provider);
    providers.sort((a, b) => (a.weight ?? 100) - (b.weight ?? 100));
    providersByNodeType.set(nodeType, providers);
  }
}

export function getProvidersForContext(context: ToolbarContext): ToolbarProvider[] {
    const { editor } = context;
    const { selection } = editor.state;
    const { $from } = selection;

    const node = $from.node($from.depth);
    const nodeType = node?.type.name;

    let activeProviders: ToolbarProvider[] = [];
    
    // Default to common providers for text selections
    if (selection instanceof TextSelection || selection instanceof AllSelection) {
        activeProviders = [...commonProviders];
    }
    
    // Get node specific providers
    if (nodeType) {
        const nodeProviders = providersByNodeType.get(nodeType) ?? [];
        
        // Check for override
        const overridingProvider = nodeProviders.find(p => p.override);
        if (overridingProvider) {
            return [overridingProvider];
        }

        activeProviders.push(...nodeProviders);
    }
    
    // Also handle cell selections specifically to get table providers
    if (selection instanceof CellSelection) {
        const tableProviders = providersByNodeType.get('table') ?? [];
        const overridingProvider = tableProviders.find(p => p.override);
        if (overridingProvider) {
            return [overridingProvider];
        }
        activeProviders.push(...tableProviders);
    }

    return activeProviders.filter(p => p.shouldShow ? p.shouldShow(context) : true)
                          .sort((a, b) => (a.weight ?? 100) - (b.weight ?? 100));
}
