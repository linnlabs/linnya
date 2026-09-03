import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slidesConsultingReferenceCase } from '../cases/slidesConsultingReference';
import { parseBenchmarkCliInvocation } from './parseBenchmarkCliInvocation';
import { resolveBenchmarkCase } from './resolveBenchmarkCase';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Benchmark CLI input', () => {
  it('解析可重复 --input，并保留路径中的等号', () => {
    expect(parseBenchmarkCliInvocation([
      'run', 'slides_consulting_reference_v1',
      '--project', 'project-1',
      '--input', 'reference_image=/tmp/reference=a.png',
      '--model', 'model-a',
      '--reasoning', 'high',
    ])).toMatchObject({
      kind: 'run',
      caseId: 'slides_consulting_reference_v1',
      projectId: 'project-1',
      inputs: { reference_image: '/tmp/reference=a.png' },
      modelId: 'model-a',
      reasoningEffort: 'high',
    });
  });

  it('校验绝对文件路径后只把路径插入 prompt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-benchmark-input-'));
    temporaryRoots.push(root);
    const image = path.join(root, 'reference.png');
    await writeFile(image, 'fixture');
    const resolved = await resolveBenchmarkCase(slidesConsultingReferenceCase, {
      reference_image: image,
    });
    expect(resolved.prompt).toContain(`视觉参考图片位于：${image}`);
    expect(resolved.prompt).not.toContain('{{reference_image}}');
    expect(resolved.inputs).toEqual({ reference_image: image });
  });

  it('缺少必需输入或传入未知输入时在启动 Agent 前失败', async () => {
    await expect(resolveBenchmarkCase(slidesConsultingReferenceCase, {}))
      .rejects.toThrow('Missing required input: reference_image');
    await expect(resolveBenchmarkCase(slidesConsultingReferenceCase, {
      unknown: '/tmp/unknown.png',
    })).rejects.toThrow('does not declare input unknown');
  });
});
