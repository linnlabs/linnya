import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const builtinNames = new Set(builtinModules);

/** `@scope/name/sub/path` → `@scope/name`；相对路径、绝对路径与 Node 内建模块返回 undefined。 */
export function readPackageNameFromSpecifier(specifier) {
  // 带 scheme 的（node:、file:、插件 Renderer 的 plugin: 等）都不是 npm 包。
  if (/^(?:\.|\/|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(specifier)) return undefined;
  const segments = specifier.split('/');
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  return builtinNames.has(name) ? undefined : name;
}

/**
 * 读出一个已构建脚本在运行时会向 node_modules 要的包名。
 * 交给 esbuild 解析而不是正则匹配：成品里大量 `require("x")` 只是代码生成器的字符串
 * （例如 ajv 的 standalone 模板），按文本扫会把它们误判成真实依赖。
 * 看不到的只有运行时拼出来的加载（createRequire 返回值、按名单转发），那部分由调用方另行声明。
 *
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function findRuntimePackageImports(filePath) {
  const result = await build({
    entryPoints: [filePath],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    // 只关心裸包名；相对路径指向的原生二进制、wasm 和运行时才生成的文件不需要存在。
    plugins: [{
      name: 'external-everything-but-entry',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => (
          args.kind === 'entry-point' ? undefined : { path: args.path, external: true }
        ));
      },
    }],
  });
  const names = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      const name = imported.external ? readPackageNameFromSpecifier(imported.path) : undefined;
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}
