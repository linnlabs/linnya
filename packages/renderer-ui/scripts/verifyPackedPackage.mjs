import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageRoot = process.cwd();
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-ui-pack-'));
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const expectedExports = [
  '.',
  './font-stack',
  './icons',
  './localization',
  './package.json',
  './scroll',
  './styles.css',
  './theme',
  './tokens.css',
  './version',
];

try {
  execFileSync(pnpmExecutable, ['pack', '--pack-destination', temporaryDirectory], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'));
  assert.equal(archives.length, 1, `预期生成一个 tarball，实际为 ${archives.length} 个`);

  execFileSync('tar', ['-xzf', path.join(temporaryDirectory, archives[0]), '-C', temporaryDirectory], {
    stdio: 'inherit',
  });
  const packedPackageRoot = path.join(temporaryDirectory, 'package');
  const packedManifest = JSON.parse(readFileSync(path.join(packedPackageRoot, 'package.json'), 'utf8'));
  assert.equal(packedManifest.private, true, 'Renderer UI 在 workspace 阶段必须保持私有包身份');
  assert.deepEqual(Object.keys(packedManifest.exports).sort(), expectedExports, 'Renderer UI exports 漂移');
  assert.ok(
    packedManifest.sideEffects?.includes('./src/styles/*.css'),
    'Renderer UI manifest 必须保留 CSS sideEffects 合同',
  );

  for (const [specifier, target] of Object.entries(packedManifest.exports)) {
    assert.equal(typeof target, 'string', `${specifier} 必须保持单一显式 export target`);
    assert.ok(existsSync(path.join(packedPackageRoot, target)), `${specifier} 的发布 target 不存在：${target}`);
  }
  assert.ok(!existsSync(path.join(packedPackageRoot, 'tests')), 'package tarball 不得包含测试目录');
  assert.ok(!existsSync(path.join(packedPackageRoot, 'scripts')), 'package tarball 不得包含仓库验证脚本');
  assert.ok(existsSync(path.join(packedPackageRoot, 'CHANGELOG.md')), 'package tarball 缺少 CHANGELOG');
  assert.ok(
    existsSync(path.join(packedPackageRoot, 'docs/release-checklist.md')),
    'package tarball 缺少发布检查表',
  );
  linkPackedRuntimeDependencies(packedPackageRoot, packedManifest.dependencies ?? {});

  const consumerRoot = path.join(temporaryDirectory, 'consumer');
  const packageScopeRoot = path.join(consumerRoot, 'node_modules/@linnya');
  mkdirSync(packageScopeRoot, { recursive: true });
  symlinkSync(
    packedPackageRoot,
    path.join(packageScopeRoot, 'renderer-ui'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  linkConsumerDependency(consumerRoot, 'vue');
  linkConsumerDependency(consumerRoot, '@vitejs/plugin-vue');
  writeFileSync(
    path.join(consumerRoot, 'index.html'),
    '<div id="app"></div><script type="module" src="/main.ts"></script>\n',
  );
  writeFileSync(
    path.join(consumerRoot, 'vite.config.mjs'),
    [
      "import vue from '@vitejs/plugin-vue';",
      '',
      'export default {',
      '  plugins: [vue()],',
      '};',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(consumerRoot, 'main.ts'),
    [
      "import { createApp, h } from 'vue';",
      "import { ActionButtons, ColorPickerPanel, CustomNumberInput, CustomTextInput, DraggablePanel, HoverTooltip, NotificationBar, SimpleDatePicker, TimePicker, createColorPickerOptions, resolveDraggablePanelPosition, resolveHoverTooltipPosition } from '@linnya/renderer-ui';",
      "import { ChevronIcon } from '@linnya/renderer-ui/icons';",
      "import { resolveBrowserFontStack } from '@linnya/renderer-ui/font-stack';",
      "import { FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT } from '@linnya/renderer-ui/localization';",
      "import { RENDERER_UI_VERSION } from '@linnya/renderer-ui/version';",
      "import '@linnya/renderer-ui/styles.css';",
      "const label = FALLBACK_SHARED_COMPONENT_LOCALIZATION_PORT.message('shared.modal.close', 'Close');",
      "const colorOptions = createColorPickerOptions([{ value: 'red', labelKey: 'red', fallbackLabel: 'Red', cssVar: '--color-accent', fallbackHex: '#d44c47' }]);",
      "const panelPosition = resolveDraggablePanelPosition({ left: 0, top: 0, width: 800, height: 600 }, { width: 400, height: 300 }, 'center', { top: 16, right: 16, bottom: 16, left: 16 });",
      "const tooltipPosition = resolveHoverTooltipPosition({ top: 10, bottom: 30, left: 10, width: 20, height: 20 }, { width: 80, height: 24 }, 800, 'bottom', 8);",
      "const fontStack = resolveBrowserFontStack('Calibri Light').resolvedFamily;",
      'createApp({',
      "  render: () => h('main', { 'data-version': RENDERER_UI_VERSION, 'data-font-stack': fontStack }, [",
      "    h(ChevronIcon, { direction: 'right', 'aria-label': label }),",
      "    h(ActionButtons, { primaryActionText: 'Continue' }),",
      "    h(CustomTextInput, { modelValue: 'Packed consumer' }),",
      "    h(CustomNumberInput, { modelValue: 4, min: 1, max: 8 }),",
      "    h(SimpleDatePicker, { modelValue: new Date(2026, 7, 31) }),",
      "    h(TimePicker, { modelValue: new Date(2026, 7, 31, 9, 30) }),",
      "    h(ColorPickerPanel, { showBackground: false, textColors: colorOptions }),",
      "    h(DraggablePanel, { visible: true, width: '400px', height: '300px', 'data-position': `${panelPosition.x}:${panelPosition.y}` }),",
      "    h(HoverTooltip, { text: 'Packed tooltip', 'data-position': `${tooltipPosition.left}:${tooltipPosition.top}` }, { default: () => h('button', 'Trigger') }),",
      "    h(NotificationBar, { visible: true, message: 'Packed notification', type: 'success' }),",
      '  ]),',
      "}).mount('#app');",
      '',
    ].join('\n'),
  );
  execFileSync(
    path.join(repositoryRoot, 'node_modules/.bin/vite'),
    ['build', '--outDir', 'dist'],
    { cwd: consumerRoot, stdio: 'inherit' },
  );
  assert.ok(existsSync(path.join(consumerRoot, 'dist/index.html')), 'packed consumer 未生成 Vite 入口');

  console.log(`Renderer UI packed consumer smoke 通过：${archives[0]}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function linkPackedRuntimeDependencies(packedPackageRoot, dependencies) {
  for (const dependencyName of Object.keys(dependencies)) {
    const installedDependency = path.join(packageRoot, 'node_modules', dependencyName);
    assert.ok(
      existsSync(installedDependency),
      `Renderer UI runtime dependency 未安装，无法执行 tarball smoke：${dependencyName}`,
    );
    const packedDependency = path.join(packedPackageRoot, 'node_modules', dependencyName);
    mkdirSync(path.dirname(packedDependency), { recursive: true });
    symlinkSync(
      installedDependency,
      packedDependency,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}

function linkConsumerDependency(consumerRoot, dependencyName) {
  const installedDependency = path.join(repositoryRoot, 'node_modules', dependencyName);
  assert.ok(
    existsSync(installedDependency),
    `packed consumer dependency 未安装：${dependencyName}`,
  );
  const consumerDependency = path.join(consumerRoot, 'node_modules', dependencyName);
  mkdirSync(path.dirname(consumerDependency), { recursive: true });
  symlinkSync(
    installedDependency,
    consumerDependency,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}
