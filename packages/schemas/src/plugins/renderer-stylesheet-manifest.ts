import { z } from 'zod';

/** Renderer artifact 内有序样式清单的固定位置。 */
export const PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH = 'dist/renderer/renderer-stylesheets.json';

export const PluginRendererStylesheetPathSchema = z
  .string()
  .regex(/^assets\/(?:[^/]+\/)*[^/]+\.css$/u, 'renderer stylesheet 必须是 assets/ 下的 CSS 相对路径');

export const PluginRendererStylesheetManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    stylesheets: z.array(PluginRendererStylesheetPathSchema),
  })
  .strict()
  .refine(manifest => new Set(manifest.stylesheets).size === manifest.stylesheets.length, {
    message: 'renderer stylesheet manifest 不得包含重复路径',
    path: ['stylesheets'],
  });

export type PluginRendererStylesheetManifest = z.infer<typeof PluginRendererStylesheetManifestSchema>;

export function parsePluginRendererStylesheetManifest(
  input: unknown,
): PluginRendererStylesheetManifest {
  return PluginRendererStylesheetManifestSchema.parse(input);
}
