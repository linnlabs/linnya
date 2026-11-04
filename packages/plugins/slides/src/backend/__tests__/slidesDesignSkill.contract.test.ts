import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSkillFile } from 'src/features/skills/frontmatter';

const slidesPackageDirectory = path.resolve(import.meta.dirname, '../../..');
const skillRoot = path.join(slidesPackageDirectory, 'resources/skills/slides-design');
const skillPath = path.join(skillRoot, 'SKILL.md');

describe('slides-design Skill 产品合同', () => {
  const rawSkill = fs.readFileSync(skillPath, 'utf-8');
  const parsed = parseSkillFile(rawSkill, skillPath, 'slides-design');

  it('frontmatter 可被 Linnya 解析，description 同时说明能力和触发场景', () => {
    expect(parsed).not.toBeNull();
    expect(parsed?.frontmatter.name).toBe('slides-design');
    expect(parsed?.frontmatter.description).toMatch(/Plan.+create.+edit.+inspect.+visually verify/iu);
    expect(parsed?.frontmatter.description).toMatch(/Use for.+PPT.+presentation.+slides/iu);
  });

  it('Default Agent 与 Slides Agent 共用同一份计划审批分支', () => {
    const body = parsed?.body ?? '';

    expect(body).toMatch(/有\s*`ppt_plan`/u);
    expect(body).toMatch(/(?:若无|没有|无)\s*`ppt_plan`/u);
    expect(body).toContain('visualDirection: { concept, composition, signature }');
    expect(body).toMatch(/若无\s*`ppt_plan`[\s\S]+相同结构/u);
    expect(body).toContain('等待用户明确批准');
    expect(body).toContain('局部内容、数据或样式修改');
  });

  it('正式能力不依赖专用 Slides 工具，并提供 CLI inspect 主路径', () => {
    const body = parsed?.body ?? '';

    expect(body).toContain('专用 Slides 工具存在时只能作为加速器');
    expect(body).toContain('linnya-slides inspect --presentation <id>');
    expect(body).toContain('presentation_id');
    expect(body).toContain('details.presentationId');
    expect(body).toContain('Agent 当前没有可调用的 PPTX export 工具');
  });

  it('资源地图将语法说明、类型真值、设计建议与可执行示例分开', () => {
    const body = parsed?.body ?? '';

    expect(body).toContain('references/syntax.md');
    expect(body).toContain('references/layoutPrimitives.d.ts');
    expect(body).toContain('references/design.md');
    expect(body).toContain('references/examples/');
    expect(fs.existsSync(path.join(skillRoot, 'references/syntax.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, 'references/examples/complete-deck.js'))).toBe(true);
  });

  it('风格索引是唯一的风格入口，并指向每份指南与页型示例', () => {
    const body = parsed?.body ?? '';
    const index = fs.readFileSync(path.join(skillRoot, 'references/styles.md'), 'utf-8');

    expect(body).toContain('references/styles.md');
    for (const guide of ['style-consulting-report', 'style-catalog-handout', 'style-cultural-imagery']) {
      expect(index).toContain(`${guide}.md`);
      expect(fs.existsSync(path.join(skillRoot, `references/${guide}.md`)), `${guide}.md missing`).toBe(true);
    }
    for (const example of ['style-consulting', 'style-catalog', 'style-cultural']) {
      expect(index).toContain(`${example}.js`);
      expect(fs.existsSync(path.join(skillRoot, `references/examples/${example}.js`)), `${example}.js missing`).toBe(true);
    }
    // 风格要靠判断而不是照抄：索引和研究风格指南都要明确说明。
    expect(index).toContain('变化轴');
    const report = fs.readFileSync(path.join(skillRoot, 'references/style-consulting-report.md'), 'utf-8');
    expect(report).toContain('## 不要做成一个模板');
    expect(report).toContain('不要照抄本文的任何具体值');
    // 咨询稿信息密、最容易压字号：下限与对应 inspect 代码必须写在本指南里，不能只留在通用 design.md。
    expect(report).toContain('font_size_below_floor');
    expect(report).toContain('不低于 9pt');
  });

  it('真实试跑反复出现的审美问题写进设计规则，示例本身也不示范这些写法', () => {
    const design = fs.readFileSync(path.join(skillRoot, 'references/design.md'), 'utf-8');
    const syntax = fs.readFileSync(path.join(skillRoot, 'references/syntax.md'), 'utf-8');
    const cultural = fs.readFileSync(path.join(skillRoot, 'references/style-cultural-imagery.md'), 'utf-8');
    // 表格默认灰表头白底不跟主题；卡片侧边色条是 AI 模板感；字少的稿子页数要多。
    expect(design).toContain('**表格默认样式**');
    expect(syntax).toContain('不跟随主题和页面底色');
    expect(design).toContain('左侧加一条竖色条');
    expect(design).toContain('字越少，页数越多');
    expect(cultural).toContain('30 页以上');
    const catalog = fs.readFileSync(path.join(skillRoot, 'references/style-catalog-handout.md'), 'utf-8');
    expect(catalog).toContain('器物对照先给图');
    expect(design).toContain('**对比只给一张表**');
    expect(design).toContain('**少字但空洞**');
    expect(cultural).toContain('## 内容：字少不等于空洞');
    expect(cultural).toContain('正文不低于 14pt');
    // 风格示例不画贴在卡片一侧的细色条（宽或高不超过 0.06in 且另一边小于 2in 的实心矩形）。
    for (const stem of ['style-consulting', 'style-catalog', 'style-cultural']) {
      const source = fs.readFileSync(path.join(skillRoot, `references/examples/${stem}.js`), 'utf-8');
      for (const match of source.matchAll(/rect\([^,]+,[^,]+,\s*([\d.]+),\s*([\d.]+),/g)) {
        const w = Number(match[1]);
        const h = Number(match[2]);
        expect(w <= 0.06 && h > 0.3, `${stem}.js 有竖色条: ${match[0]}`).toBe(false);
      }
    }
  });

  it('人文展示与图录阅读两份指南互相指向，图录的栅格规则只在图录指南里', () => {
    const cultural = fs.readFileSync(path.join(skillRoot, 'references/style-cultural-imagery.md'), 'utf-8');
    const catalog = fs.readFileSync(path.join(skillRoot, 'references/style-catalog-handout.md'), 'utf-8');

    expect(cultural).toContain('style-catalog-handout.md');
    expect(catalog).toContain('style-cultural-imagery.md');
    expect(cultural).not.toContain('## 高密度页');
    expect(catalog).toContain('## 版式系统');
  });
});
