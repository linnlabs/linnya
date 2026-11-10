import { ProbeError } from '../definitions/probeContract.mjs';
import { unwrapCdpResult } from '../infrastructure/cdpClient.mjs';
import { resolveTarget } from './probePage.mjs';

const genericFamilies = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'emoji', 'math',
]);

/**
 * 字体栈写的是“想用什么”，Chromium 实际排版用的是另一回事：
 * 名字写错或系统匹配不到时会静默回退。这里同时给出声明与实际渲染字体。
 */
export async function inspectFonts(cdp, targets) {
  await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('CSS.enable');
  const results = [];
  for (const target of targets) {
    const objectId = await resolveTarget(cdp, target);
    const declared = unwrapCdpResult(await cdp.send('Runtime.callFunctionOn', {
      objectId, returnByValue: true,
      functionDeclaration: `function () {
        const element = this.nodeType === Node.TEXT_NODE ? this.parentElement : this;
        const style = getComputedStyle(element);
        return {
          text: (this.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 40),
          fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        };
      }`,
    }));
    const { nodeId } = await cdp.send('DOM.requestNode', { objectId });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    if (!fonts.length) throw new ProbeError('NOT_FOUND', '目标没有直接排版的文字', '指向含文字的最内层元素，或用 text=<文字>');
    const stack = declared.fontFamily.split(',').map(name => name.trim().replace(/^["']|["']$/g, ''));
    const rendered = fonts.map(font => ({ family: font.familyName, glyphs: font.glyphCount, ...(font.isCustomFont && { webFont: true }) }));
    results.push({
      target: target.ref ?? target.selector ?? `text=${target.text}`, text: declared.text,
      declared: stack.slice(0, 4).join(', ') + (stack.length > 4 ? ', …' : ''),
      size: declared.fontSize, weight: declared.fontWeight, rendered,
      // 首个具名字体没有出现在实际字体里，说明它没生效；这是最常见的“字体看着不对”。
      ...(!genericFamilies.has(stack[0].toLowerCase()) && {
        firstDeclaredUsed: rendered.some(font => font.family.toLowerCase() === stack[0].toLowerCase()),
      }),
    });
  }
  return { fonts: results };
}
