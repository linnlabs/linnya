function readFactoryPackageNames(backendBundle) {
  return new Set(
    Array.from(
      backendBundle.matchAll(/["']?package_name["']?\s*:\s*["']([^"']+)["']/g),
      match => match[1]
    )
  );
}

const AI_SDK_ADAPTER_PACKAGE_NAMES = new Set(['@linnlabs/linnkit-provider-ai-sdk']);

/**
 * 查找后端 CJS 产物中仍由运行时 require 加载的 adapter、AI SDK/Provider package。
 *
 * 第三方 package 名来自 factory registry 随产物保留的 package_name 元数据，避免门禁
 * 只认识 @ai-sdk/* 命名空间而漏掉 OpenRouter 这类正式 package。
 */
export function findExternalProviderRuntimeRequires(backendBundle) {
  const factoryPackageNames = readFactoryPackageNames(backendBundle);
  const externalRequires = Array.from(
    backendBundle.matchAll(/require\(["']([^"']+)["']\)/g),
    match => match[1]
  );

  return [
    ...new Set(
      externalRequires.filter(
        packageName =>
          AI_SDK_ADAPTER_PACKAGE_NAMES.has(packageName) ||
          packageName === 'ai' ||
          packageName.startsWith('@ai-sdk/') ||
          factoryPackageNames.has(packageName)
      )
    ),
  ].sort();
}
