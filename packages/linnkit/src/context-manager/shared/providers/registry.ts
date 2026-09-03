import type { IContextProvider } from './base';

export class ContextProviderRegistry<TConfig = unknown> {
  private providers: Map<string, IContextProvider<TConfig>> = new Map();

  register(provider: IContextProvider<TConfig>): void {
    this.providers.set(provider.name, provider);
  }

  getAllProviders(): IContextProvider<TConfig>[] {
    return Array.from(this.providers.values()).sort((a, b) => a.priority - b.priority);
  }

  getProvider(name: string): IContextProvider<TConfig> | undefined {
    return this.providers.get(name);
  }

  clear(): void {
    this.providers.clear();
  }
}
