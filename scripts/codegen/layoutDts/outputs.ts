/**
 * outputs — centralised paths and source-file references used by the
 * generator and checker. Lifted out of the CLI driver so unit tests
 * can import the same constants without spawning a subprocess.
 *
 * Paths are returned **relative to the repo root**, never absolute.
 * Resolution to absolute paths happens in the driver.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repository root (scripts/codegen/layoutDts/.. → scripts/codegen/.. → scripts/.. → repo). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Source files whose top-level exports become the module-scope d.ts types.
 *
 * `shapeGeometry` is listed alongside the flex contract because `LayoutShapeNode.geometry`
 * is typed as `ShapeGeometrySpec` — a six-member union covering presets, parameterised
 * geometry, polygons and typed paths. Extracting only the flex contract left that name as an
 * `unknown` stub, which silently disabled sandbox typechecking for every custom shape and
 * gave the AI no discoverable evidence that anything beyond `"rect"` existed.
 */
export const LAYOUT_TYPES_SOURCES = [
  path.join(
    REPO_ROOT,
    'packages',
    'plugins',
    'slides',
    'src',
    'shared',
    'brushArtwork',
    'definitions',
    'brushArtworkAuthoring.ts',
  ),
  path.join(
    REPO_ROOT,
    'packages',
    'plugins',
    'slides',
    'src',
    'shared',
    'flexComposeContract.ts',
  ),
  path.join(
    REPO_ROOT,
    'packages',
    'plugins',
    'slides',
    'src',
    'shared',
    'shapeGeometry',
    'definitions',
    'shapeGeometry.ts',
  ),
  path.join(
    REPO_ROOT,
    'packages',
    'plugins',
    'slides',
    'src',
    'shared',
    'svgGraphic',
    'definitions',
    'svgGraphic.ts',
  ),
  path.join(
    REPO_ROOT,
    'packages',
    'plugins',
    'slides',
    'src',
    'shared',
    'deckSpec',
    'slideSize.ts',
  ),
];

/**
 * Where to write the generated d.ts. Listed relative to repo root so
 * error messages and CI output stay portable across machines.
 *
 * D10 (single source for AI reference + sandbox typecheck) is satisfied
 * by writing **byte-identical** content to every path:
 *
 * 1. `packages/plugins/slides/src/backend/sandbox/pptComposeProfile.ambient.d.ts` —
 *    canonical Slides plugin source artifact consumed by
 *    `typecheckCodegenSource` at runtime.
 * 2. `packages/plugins/slides/resources/skills/slides-design/references/`
 *    `layoutPrimitives.d.ts` — AI-skill reference mirror surfaced through
 *    the slides-design SKILL.md "Reference Loading Rule" so the AI can
 *    read the exact same shapes the typecheck enforces. Authored as a
 *    real file (not a symlink) so the skill discovery loader treats it
 *    as a regular reference and so it survives `tar` / `zip` packaging
 *    that might break symlinks.
 *
 * Both files MUST be byte-identical; `scripts/codegen/check-layout-dts.ts`
 * fails CI on any drift.
 */
export const LAYOUT_DTS_OUTPUT_PATHS_RELATIVE: readonly string[] = Object.freeze([
  'packages/plugins/slides/src/backend/sandbox/pptComposeProfile.ambient.d.ts',
  'packages/plugins/slides/resources/skills/slides-design/references/layoutPrimitives.d.ts',
]);

/** Resolve all output paths to absolute filesystem paths. */
export function resolveOutputPaths(): string[] {
  return LAYOUT_DTS_OUTPUT_PATHS_RELATIVE.map((p) => path.join(REPO_ROOT, p));
}
