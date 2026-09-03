import { describe, expect, it } from 'vitest';
import { executeInSandbox } from '../CodeSandbox.js';

describe('CodeSandbox', () => {
  // ─── 正常执行 ────────────────────────────────────────────────────────

  describe('正常执行', () => {
    it('执行简单表达式并返回结果', () => {
      const result = executeInSandbox<number>('return 1 + 2;');
      expect(result.success).toBe(true);
      expect(result.value).toBe(3);
      expect(result.error).toBeUndefined();
    });

    it('执行多行代码并返回最终 return 值', () => {
      const code = `
        const a = 10;
        const b = 20;
        return a * b;
      `;
      const result = executeInSandbox<number>(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe(200);
    });

    it('可以构建并返回复杂 JSON 对象', () => {
      const code = `
        const deck = {
          title: 'Test',
          slides: [{ elements: [{ type: 'text', content: 'Hello' }] }],
        };
        return deck;
      `;
      const result = executeInSandbox<{ title: string }>(code);
      expect(result.success).toBe(true);
      expect(result.value?.title).toBe('Test');
    });

    it('无 return 时返回 undefined', () => {
      const result = executeInSandbox('const x = 42;');
      expect(result.success).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('记录 elapsedMs', () => {
      const result = executeInSandbox('return true;');
      expect(result.success).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── console.log 收集 ────────────────────────────────────────────────

  describe('日志收集', () => {
    it('收集 console.log 输出', () => {
      const code = `
        console.log('hello');
        console.log('world', 123);
        return 'done';
      `;
      const result = executeInSandbox(code);
      expect(result.success).toBe(true);
      expect(result.logs).toEqual(['hello', 'world 123']);
    });

    it('收集 console.warn 和 console.error', () => {
      const code = `
        console.warn('warning');
        console.error('error');
        return true;
      `;
      const result = executeInSandbox(code);
      expect(result.logs).toEqual(['warning', 'error']);
    });

    it('日志超过上限后自动截断', () => {
      const code = `
        for (let i = 0; i < 300; i++) {
          console.log('line ' + i);
        }
        return true;
      `;
      const result = executeInSandbox(code);
      expect(result.success).toBe(true);
      expect(result.logs.length).toBeLessThanOrEqual(200);
    });
  });

  // ─── 注入全局变量 ────────────────────────────────────────────────────

  describe('全局变量注入', () => {
    it('可以访问注入的变量', () => {
      const result = executeInSandbox<number>('return SLIDE_W * 2;', {
        globals: { SLIDE_W: 10 },
      });
      expect(result.success).toBe(true);
      expect(result.value).toBe(20);
    });

    it('可以调用注入的函数', () => {
      let captured: unknown = null;
      const compose = (data: unknown) => { captured = data; };

      const code = `
        compose({ title: 'Hello' });
        return 'ok';
      `;
      const result = executeInSandbox(code, {
        globals: { compose },
      });
      expect(result.success).toBe(true);
      expect(captured).toEqual({ title: 'Hello' });
    });

    it('可以使用注入的 JSON 和 Math', () => {
      const code = `
        const obj = JSON.parse('{"x":1}');
        return Math.max(obj.x, 5);
      `;
      const result = executeInSandbox<number>(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });
  });

  // ─── 语法错误 ────────────────────────────────────────────────────────

  describe('语法错误', () => {
    it('捕获语法错误并返回结构化信息', () => {
      const result = executeInSandbox('const x = {;');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('syntax');
      expect(result.error?.message).toBeTruthy();
    });

    it('语法错误包含行号信息', () => {
      const code = `const a = 1;\nconst b = {;`;
      const result = executeInSandbox(code);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('syntax');
      expect(result.error?.line).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 运行时错误 ──────────────────────────────────────────────────────

  describe('运行时错误', () => {
    it('捕获 ReferenceError', () => {
      const result = executeInSandbox('return undeclaredVariable;');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('runtime');
      expect(result.error?.message).toContain('undeclaredVariable');
    });

    it('捕获 TypeError', () => {
      const result = executeInSandbox('null.toString();');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('runtime');
    });

    it('捕获自定义 throw', () => {
      const result = executeInSandbox('throw new Error("custom error");');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('runtime');
      expect(result.error?.message).toContain('custom error');
    });

    it('运行时错误仍保留之前的日志', () => {
      const code = `
        console.log('before error');
        throw new Error('boom');
      `;
      const result = executeInSandbox(code);
      expect(result.success).toBe(false);
      expect(result.logs).toEqual(['before error']);
    });
  });

  // ─── 超时保护 ────────────────────────────────────────────────────────

  describe('超时保护', () => {
    it('死循环在超时后被中断', () => {
      const result = executeInSandbox('while(true) {}', { timeoutMs: 100 });
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('timeout');
      expect(result.error?.message).toContain('超时');
    });

    it('正常代码在超时时间内完成', () => {
      const code = `
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      `;
      const result = executeInSandbox<number>(code, { timeoutMs: 5000 });
      expect(result.success).toBe(true);
      expect(result.value).toBe(499500);
    });
  });

  // ─── 安全隔离 ────────────────────────────────────────────────────────

  describe('安全隔离', () => {
    it('无法访问 Node.js 全局对象 process', () => {
      const result = executeInSandbox('return typeof process;');
      expect(result.success).toBe(true);
      expect(result.value).toBe('undefined');
    });

    it('无法访问 require', () => {
      const result = executeInSandbox('return typeof require;');
      expect(result.success).toBe(true);
      expect(result.value).toBe('undefined');
    });

    it('无法访问 global', () => {
      const result = executeInSandbox('return typeof global;');
      expect(result.success).toBe(true);
      expect(result.value).toBe('undefined');
    });

    it('无法通过 this 逃逸（strict mode）', () => {
      const result = executeInSandbox('return typeof this;');
      expect(result.success).toBe(true);
      expect(result.value).toBe('undefined');
    });

    it('constructor 属性被冻结，无法通过原型链逃逸', () => {
      // 经典的 vm 沙箱逃逸手法
      const result = executeInSandbox(`
        try {
          const ForeignFunction = ({}).constructor.constructor;
          const proc = ForeignFunction('return process')();
          return 'escaped: ' + typeof proc;
        } catch (e) {
          return 'blocked: ' + e.message;
        }
      `);
      expect(result.success).toBe(true);
      // 由于 constructor 被冻结，要么返回 blocked，要么 ForeignFunction 行为不同
      expect(String(result.value)).toMatch(/blocked|undefined/);
    });

    it('无法修改冻结的原型属性', () => {
      const result = executeInSandbox(`
        try {
          Object.prototype.constructor = function() {};
          return 'modified';
        } catch (e) {
          return 'blocked';
        }
      `);
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');
    });

    it('严格模式阻止隐式全局变量', () => {
      // strict mode 下给未声明变量赋值会报 ReferenceError
      const result = executeInSandbox('x = 42;');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('runtime');
    });
  });

  // ─── 复杂场景（模拟 ppt_codegen 用法）────────────────────────────────

  describe('实际使用模式', () => {
    it('模拟 compose 回调模式：代码构建数据后调用 compose()', () => {
      let capturedInput: unknown = null;
      const compose = (input: unknown) => { capturedInput = input; };

      const code = `
        const deck = {
          title: '季度报告',
          slides: [],
        };
        for (let i = 1; i <= 3; i++) {
          deck.slides.push({
            elements: [
              { type: 'text', content: '第 ' + i + ' 页', position: { x: 0.5, y: 0.3, w: 9, h: 0.8 } },
            ],
          });
        }
        compose(deck);
      `;

      const result = executeInSandbox(code, {
        globals: { compose, SLIDE_W: 10, SLIDE_H: 5.625 },
      });
      expect(result.success).toBe(true);

      const deck = capturedInput as { title: string; slides: unknown[] };
      expect(deck.title).toBe('季度报告');
      expect(deck.slides).toHaveLength(3);
    });

    it('代码中使用循环和条件逻辑生成复杂结构', () => {
      const code = `
        const categories = ['Q1', 'Q2', 'Q3', 'Q4'];
        const values = [120, 230, 180, 350];
        const elements = [];
        
        for (let i = 0; i < categories.length; i++) {
          elements.push({
            type: 'text',
            content: categories[i] + ': ' + values[i],
            position: { x: 0.5, y: 0.5 + i * 1.2, w: 9, h: 0.8 },
          });
        }
        
        return { elements, total: values.reduce(function(a, b) { return a + b; }, 0) };
      `;
      const result = executeInSandbox<{ elements: unknown[]; total: number }>(code);
      expect(result.success).toBe(true);
      expect(result.value?.elements).toHaveLength(4);
      expect(result.value?.total).toBe(880);
    });
  });
});
