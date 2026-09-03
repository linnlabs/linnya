const stylelint = require('stylelint');

const ruleName = 'linnya/no-legacy-style-tokens';
const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (token) => `旧样式变量 ${token} 已进入收敛清单，请改用 style-guide 中的新 token。`,
});

const legacyTokens = new Set([
  '--text-color',
  '--text-color-primary',
  '--text-color-secondary',
  '--text-color-dark',
  '--text-secondary',
  '--text-secondary-dark',
  '--text-tertiary',
  '--text-muted',
  '--text-muted-dark',
  '--text-hint',
  '--placeholder-color',
  '--color-text-hint',
  '--color-header-text',
  '--bg-color',
  '--bg-color-dark',
  '--content-bg-color',
  '--menu-bg-color',
  '--menu-hover-color',
  '--status-bar-bg-color',
  '--bg-light',
  '--bg-dark',
  '--color-background-default',
  '--color-background-surface',
  '--color-background-sidebar',
  '--color-background-subtle',
  '--color-background-disabled',
  '--color-background-search',
  '--color-background-search-light',
  '--color-background-selection',
  '--border-color',
  '--border-light',
  '--border-gray',
  '--border-hover-color',
  '--color-border-primary-light',
  '--primary-color',
  '--primary-color-light',
  '--primary-color-very-light',
  '--primary-color-light-hover',
  '--secondary-color',
  '--color-accent-primary',
  '--color-accent-primary-hover',
  '--color-accent-primary-hover-light',
  '--color-accent-primary-rgb',
  '--color-accent-primary-secondary',
  '--color-accent-primary-light',
  '--color-accent-primary-very-light',
  '--color-accent-primary-disabled',
  '--color-accent-background',
  '--color-accent-background-light',
  '--color-accent-background-hover',
  '--hover-color',
  '--hover-color-dark',
  '--active-color',
  '--focus-color',
  '--color-interactive-surface-hover',
  '--color-interactive-surface-hover-light',
  '--color-interactive-surface-hover-darker',
  '--color-interactive-surface-active',
  '--color-interactive-handle-hover',
  '--link-color',
  '--link-hover-color',
  '--color-shadow-extra-light',
  '--color-shadow-light',
  '--color-shadow-default',
  '--color-shadow-medium',
  '--color-shadow-strong',
  '--color-button-primary-background',
  '--color-button-primary-background-hover',
  '--color-button-primary-background-active',
  '--color-button-primary-text',
  '--color-button-primary-border',
  '--color-button-secondary-background',
  '--color-button-secondary-background-hover',
  '--color-button-secondary-background-active',
  '--color-button-secondary-text',
  '--color-button-secondary-text-hover',
  '--color-button-secondary-border',
  '--color-button-secondary-border-hover',
  '--h1-color',
  '--h2-color',
  '--h3-color',
  '--h4-h5-h6-color',
  '--success-color',
  '--error-color',
  '--danger-color',
  '--warning-color',
  '--info-color',
  '--success-bg-color',
  '--error-bg-color',
  '--warning-bg-color',
  '--warning-bg-color-light',
  '--warning-bg-color-darker',
  '--info-bg-color',
  '--info-bg-color-light',
  '--info-bg-color-dark',
  '--success-color-light',
  '--error-color-light',
  '--warning-color-light',
  '--info-color-light',
  '--success-hover-color',
  '--error-hover-color',
  '--warning-hover-color',
  '--info-hover-color',
  '--success-button-bg',
  '--success-button-hover',
  '--success-button-active',
  '--success-button-text-color',
  '--error-button-bg',
  '--error-button-hover',
  '--error-button-active',
  '--error-button-text-color',
  '--warning-button-bg',
  '--warning-button-hover',
  '--warning-button-active',
  '--warning-button-text-color',
  '--info-button-bg',
  '--info-button-hover',
  '--info-button-active',
  '--info-button-text-color',
  '--highlight-keyword',
  '--highlight-function',
  '--highlight-variable',
  '--highlight-string',
  '--highlight-builtin',
  '--highlight-tag',
  '--highlight-attribute',
  '--highlight-comment',
]);

const plugin = stylelint.createPlugin(ruleName, (primaryOption) => {
  return (root, result) => {
    const enabled = primaryOption !== false;
    if (!enabled) {
      return;
    }

    root.walkDecls((decl) => {
      const tokens = new Set();

      if (legacyTokens.has(decl.prop)) {
        tokens.add(decl.prop);
      }

      for (const match of decl.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        if (legacyTokens.has(match[1])) {
          tokens.add(match[1]);
        }
      }

      for (const token of tokens) {
        stylelint.utils.report({
          message: messages.rejected(token),
          node: decl,
          result,
          ruleName,
          word: token,
        });
      }
    });
  };
});

plugin.ruleName = ruleName;
plugin.messages = messages;

module.exports = plugin;
