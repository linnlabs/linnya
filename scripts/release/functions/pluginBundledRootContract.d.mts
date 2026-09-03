export function assertBundledPluginRootMatchesPluginIds(input: {
  readonly bundledPluginRoot: string;
  readonly expectedPluginIds: readonly string[];
}): string[];
