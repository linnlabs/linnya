/**
 * @file src/audio-preprocessing/vadProcessor.test.ts
 * 
 * @brief VAD 处理器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VadProcessor } from './vadProcessor';
import { AudioPreprocessingConfig, DEFAULT_CONFIG } from './config';
import { AudioData } from './types';

describe('VadProcessor - 重叠切分测试', () => {
  let processor: VadProcessor;
  const sampleRate = 16000;

  beforeEach(() => {
    const config: AudioPreprocessingConfig = {
      ...DEFAULT_CONFIG,
      segmentation: {
        segmentThresholdS: 10,      // 短一些便于测试
        maxSegmentThresholdS: 15,
        overlapS: 2,                 // 2秒重叠
        enableVadSegmentation: false, // 使用固定切分便于测试
      },
    };
    processor = new VadProcessor(config);
  });

  it('应该正确生成无重叠的音频片段（overlapS=0）', async () => {
    // 创建40秒的测试音频
    const audioData = new Float32Array(40 * sampleRate);
    
    // 禁用重叠
    const config: AudioPreprocessingConfig = {
      ...DEFAULT_CONFIG,
      segmentation: {
        segmentThresholdS: 10,
        maxSegmentThresholdS: 15,
        overlapS: 0,  // 无重叠
        enableVadSegmentation: false,
      },
    };
    const noOverlapProcessor = new VadProcessor(config);

    const result = await noOverlapProcessor.process(audioData, sampleRate);

    // 验证片段数量
    expect(result.segments.length).toBeGreaterThan(1);

    // 验证无重叠
    for (let i = 1; i < result.segments.length; i++) {
      const prev = result.segments[i - 1];
      const curr = result.segments[i];
      
      // 当前片段的开始应该等于前一个片段的结束
      expect(curr.startSample).toBe(prev.endSample);
      expect(curr.startTime).toBeCloseTo(prev.endTime, 2);
    }

    // 验证没有间隙或重叠
    const totalCoverage = result.segments.reduce((sum, seg) => 
      sum + (seg.endSample - seg.startSample), 0
    );
    expect(totalCoverage).toBe(audioData.length);
  });

  it('应该正确生成带重叠的音频片段（overlapS=2）', async () => {
    // 创建40秒的测试音频
    const audioData = new Float32Array(40 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);

    // 验证片段数量
    expect(result.segments.length).toBeGreaterThan(2);

    // 验证重叠
    for (let i = 1; i < result.segments.length; i++) {
      const prev = result.segments[i - 1];
      const curr = result.segments[i];
      
      // 当前片段应该在前一个片段结束前开始（产生重叠）
      expect(curr.startTime).toBeLessThan(prev.endTime);
      
      // 重叠时长应该接近配置值（2秒）
      const overlapDuration = prev.endTime - curr.startTime;
      expect(overlapDuration).toBeGreaterThan(0);
      expect(overlapDuration).toBeLessThanOrEqual(3); // 允许一些误差
    }
  });

  it('第一个片段不应该向前扩展重叠', async () => {
    const audioData = new Float32Array(40 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);

    // 第一个片段应该从0开始
    expect(result.segments[0].startSample).toBe(0);
    expect(result.segments[0].startTime).toBe(0);
  });

  it('最后一个片段不应该向后扩展重叠', async () => {
    const audioData = new Float32Array(40 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);

    // 最后一个片段应该在音频结尾结束
    const lastSegment = result.segments[result.segments.length - 1];
    expect(lastSegment.endSample).toBe(audioData.length);
    expect(lastSegment.endTime).toBeCloseTo(40, 2);
  });

  it('应该处理短音频（无需切分）', async () => {
    // 创建5秒的短音频（小于 maxSegmentThresholdS）
    const audioData = new Float32Array(5 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);

    // 应该只有一个片段
    expect(result.segments.length).toBe(1);
    expect(result.segments[0].startSample).toBe(0);
    expect(result.segments[0].endSample).toBe(audioData.length);
  });

  it('重叠配置应该正确影响片段生成', async () => {
    const audioData = new Float32Array(40 * sampleRate);

    // 测试不同的重叠配置
    const overlapValues = [0, 1, 3, 5];
    
    for (const overlapS of overlapValues) {
      const config: AudioPreprocessingConfig = {
        ...DEFAULT_CONFIG,
        segmentation: {
          segmentThresholdS: 10,
          maxSegmentThresholdS: 15,
          overlapS,
          enableVadSegmentation: false,
        },
      };
      const testProcessor = new VadProcessor(config);
      
      const result = await testProcessor.process(audioData, sampleRate);

      if (overlapS === 0) {
        // 无重叠：相邻片段应该首尾相接
        for (let i = 1; i < result.segments.length; i++) {
          expect(result.segments[i].startSample).toBe(result.segments[i - 1].endSample);
        }
      } else {
        // 有重叠：验证重叠时长
        for (let i = 1; i < result.segments.length - 1; i++) {
          const prev = result.segments[i - 1];
          const curr = result.segments[i];
          const overlap = prev.endTime - curr.startTime;
          
          // 重叠应该大于0且不超过配置值太多
          expect(overlap).toBeGreaterThan(0);
          expect(overlap).toBeLessThanOrEqual(overlapS + 1); // 允许1秒误差
        }
      }
    }
  });

  it('应该正确计算片段的时间戳', async () => {
    const audioData = new Float32Array(30 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);

    for (const segment of result.segments) {
      // 验证采样点和时间的对应关系
      expect(segment.startTime).toBeCloseTo(segment.startSample / sampleRate, 2);
      expect(segment.endTime).toBeCloseTo(segment.endSample / sampleRate, 2);
      
      // 验证持续时长
      expect(segment.duration).toBeCloseTo(segment.endTime - segment.startTime, 2);
      
      // 验证音频数据长度
      expect(segment.data.length).toBe(segment.endSample - segment.startSample);
    }
  });

  it('应该正确处理边界情况', async () => {
    // 测试极短音频
    const tinyAudio = new Float32Array(100); // 约0.006秒
    const tinyResult = await processor.process(tinyAudio, sampleRate);
    expect(tinyResult.segments.length).toBe(1);

    // 测试恰好等于阈值的音频
    const exactAudio = new Float32Array(15 * sampleRate); // 恰好15秒
    const exactResult = await processor.process(exactAudio, sampleRate);
    expect(exactResult.segments.length).toBeGreaterThanOrEqual(1);
  });

  it('VAD统计信息应该正确', async () => {
    const audioData = new Float32Array(40 * sampleRate);
    
    const result = await processor.process(audioData, sampleRate);
    const stats = processor.getStats(result);

    expect(stats.totalSegments).toBe(result.segments.length);
    expect(stats.totalSegments).toBeGreaterThan(0);
    expect(stats.avgSegmentDuration).toBeGreaterThan(0);
    // 因为重叠，平均时长可能略超过 maxSegmentThresholdS
    expect(stats.avgSegmentDuration).toBeLessThanOrEqual(17); // 15 + 2秒重叠
  });
});

describe('VadProcessor - 固定切分 vs VAD切分', () => {
  it('固定切分应该生成均匀的片段', async () => {
    const config: AudioPreprocessingConfig = {
      ...DEFAULT_CONFIG,
      segmentation: {
        segmentThresholdS: 10,
        maxSegmentThresholdS: 10, // 设置相同值，强制固定切分
        overlapS: 0,
        enableVadSegmentation: false,
      },
    };
    const processor = new VadProcessor(config);
    
    const audioData = new Float32Array(40 * 16000);
    const result = await processor.process(audioData, 16000);

    // 固定切分应该产生大致相同长度的片段（除了最后一个）
    for (let i = 0; i < result.segments.length - 1; i++) {
      const duration = result.segments[i].duration;
      expect(duration).toBeCloseTo(10, 1); // 允许1秒误差
    }

    expect(result.method).toBe('fixed');
  });
});

describe('VadProcessor - 数据完整性测试', () => {
  it('所有片段的音频数据总和应该覆盖完整音频（无重叠情况）', async () => {
    const config: AudioPreprocessingConfig = {
      ...DEFAULT_CONFIG,
      segmentation: {
        segmentThresholdS: 10,
        maxSegmentThresholdS: 15,
        overlapS: 0, // 无重叠
        enableVadSegmentation: false,
      },
    };
    const processor = new VadProcessor(config);
    
    const audioData = new Float32Array(40 * 16000);
    // 填充一些测试数据
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] = Math.sin(i / 100);
    }
    
    const result = await processor.process(audioData, 16000);

    // 验证所有片段加起来覆盖完整音频
    let totalSamples = 0;
    for (const segment of result.segments) {
      totalSamples += segment.data.length;
    }
    
    expect(totalSamples).toBe(audioData.length);
  });

  it('片段的音频数据应该与原始数据一致', async () => {
    const config: AudioPreprocessingConfig = {
      ...DEFAULT_CONFIG,
      segmentation: {
        segmentThresholdS: 10,
        maxSegmentThresholdS: 15,
        overlapS: 0,
        enableVadSegmentation: false,
      },
    };
    const processor = new VadProcessor(config);
    
    const audioData = new Float32Array(40 * 16000);
    // 填充特定的测试数据
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] = i % 256 / 128 - 1; // 范围 [-1, 1)
    }
    
    const result = await processor.process(audioData, 16000);

    // 验证每个片段的数据与原始数据匹配；避免在 64 万采样点上逐个调用 expect 导致并发测试超时。
    let mismatch:
      | {
          segmentIndex: number;
          sampleIndex: number;
          originalIndex: number;
          actual: number | undefined;
          expected: number | undefined;
        }
      | undefined;

    for (let segmentIndex = 0; segmentIndex < result.segments.length; segmentIndex += 1) {
      const segment = result.segments[segmentIndex];
      if (!segment) continue;

      for (let sampleIndex = 0; sampleIndex < segment.data.length; sampleIndex += 1) {
        const originalIndex = segment.startSample + sampleIndex;
        const actual = segment.data[sampleIndex];
        const expected = audioData[originalIndex];
        if (actual !== expected) {
          mismatch = {
            segmentIndex,
            sampleIndex,
            originalIndex,
            actual,
            expected,
          };
          break;
        }
      }

      if (mismatch) break;
    }

    expect(mismatch).toBeUndefined();
  });
});
