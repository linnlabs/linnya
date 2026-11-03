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

  it('两种人文风格各有导航入口，且互相指向对方', () => {
    const body = parsed?.body ?? '';
    const cultural = fs.readFileSync(path.join(skillRoot, 'references/style-cultural-imagery.md'), 'utf-8');
    const catalog = fs.readFileSync(path.join(skillRoot, 'references/style-catalog-handout.md'), 'utf-8');

    expect(body).toContain('references/style-cultural-imagery.md');
    expect(body).toContain('references/style-catalog-handout.md');
    expect(cultural).toContain('style-catalog-handout.md');
    expect(catalog).toContain('style-cultural-imagery.md');
    // 图录阅读稿的栅格和图注规则只属于一份指南，不在展示稿指南里重复。
    expect(cultural).not.toContain('## 高密度页');
    expect(catalog).toContain('## 版式系统');
  });

  it('专业研究风格有独立入口，并要求页型随内容变化而不是套模板', () => {
    const body = parsed?.body ?? '';
    const report = fs.readFileSync(path.join(skillRoot, 'references/style-consulting-report.md'), 'utf-8');

    expect(body).toContain('references/style-consulting-report.md');
    expect(report).toContain('## 不要做成一个模板');
    expect(report).toContain('不要照抄本文的任何具体值');
  });
});
