// src/renderer/features/AudioBlock/services/transcriptionService.js
// 该文件负责与后端的音频转录API进行通信。

import { apiFetch, getApiBaseUrl } from '../../../../../shared/services/aiService/common';
import { readSelectedModelPurposeBinding } from '@/domains/model-configuration';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import { buildAudioBlockFileTooLargeError } from '../functions/audioBlockPresentation';
import { resolveCurrentSystemOperationFailure } from '../../../../../app/system/functions/resolveCurrentSystemOperationFailure';

/**
 * 调用后端代理API来转录音频文件。
 * @param {Blob} audioBlob - 要转录的音频Blob对象。
 * @param {string} mimeType - 音频的MIME类型 (例如 'audio/webm')。
 * @param {string} [filename] - (可选) 原始文件名，如果未提供则自动生成。
 * @param {number} [duration] - (可选) 音频时长（秒），用于判断是否使用长音频转录。
 * @returns {Promise<object>} 包含转录结果或错误信息的对象。
 */
export const transcribeAudio = async (audioBlob, mimeType, filename = null, duration = 0) => {
  const fileSizeMB = (audioBlob.size / (1024 * 1024)).toFixed(2);
  const isLongAudio = duration > 180 || (duration === 0 && audioBlob.size > 2 * 1024 * 1024);
  
  console.log(`🎙️ [前端] 开始转录请求: ${filename || '未命名'}`);
  console.log(`📊 [前端] 文件信息: ${fileSizeMB}MB, ${duration.toFixed(1)}秒, ${isLongAudio ? '长音频(流式处理)' : '短音频'}`);
  
  // 设置进度监听器（仅用于长音频）
  let progressListener = null;
  if (isLongAudio && window.electronAPI && window.electronAPI.onTranscriptionProgress) {
    console.log(`⏳ [前端] 长音频流式处理，启用实时进度监听`);
    progressListener = window.electronAPI.onTranscriptionProgress((progress) => {
      console.log(`📊 [前端进度] ${progress.percent.toFixed(1)}% - ${progress.stage} - ${progress.message}`);
    });
  }
  
  // 检查文件大小限制（25MB）
  const maxFileSize = 25 * 1024 * 1024; // 25MB in bytes
  if (audioBlob.size > maxFileSize) {
    const fileSizeMB = (audioBlob.size / (1024 * 1024)).toFixed(2);
    throw new Error(buildAudioBlockFileTooLargeError(fileSizeMB, resolveCurrentEditorMessage));
  }
  
  try {
    const apiUrl = await getApiBaseUrl();
    
    if (!apiUrl) {
      throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.apiBaseUrlUnavailable'));
    }

    // 获取用户选择的转录模型ID
    const transcriptionModelId = readSelectedModelPurposeBinding('transcription');

    const formData = new FormData();
    // 使用提供的文件名或生成一个
    let finalFilename;
    if (filename) {
      finalFilename = filename;
    } else {
      // 回退到原有的生成逻辑
      const timestamp = new Date().toISOString().split('T')[0]; // 格式: 2025-06-22
      const fileExtension = mimeType.split('/')[1] || 'webm';
      finalFilename = `recording-${timestamp}-audio.${fileExtension}`;
    }
    
    formData.append('file', audioBlob, finalFilename);
    
    // 传递音频时长，用于后端判断是否使用长音频转录
    if (duration > 0) {
      formData.append('duration', duration.toString());
    }

    // 传递用户选择的转录模型ID
    if (transcriptionModelId) {
      formData.append('modelId', transcriptionModelId);
    }

    const response = await apiFetch(`${apiUrl}/api/v1/transcription/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to parse transcription error response',
      }));
      throw new Error(resolveCurrentSystemOperationFailure(
        errorData,
        'system.transcription.failed',
      ));
    }

    const result = await response.json();
    
    console.log(`✅ [前端] 转录完成: ${result.text?.length || 0} 字符, ${result.segments?.length || 0} 个段落`);
    if (result.stats) {
      console.log(`📈 [前端] 处理统计:`, result.stats);
    }
    
    // 清理进度监听器
    if (progressListener) {
      progressListener();
    }
    
    // 返回统一格式（包含 text 和 segments）
    return { 
      success: true, 
      text: result.text,
      segments: result.segments || [], // 带时间戳的段落
      metadata: result.metadata || {},
    };

  } catch (error) {
    console.error('音频转录请求失败:', error);
    
    // 清理进度监听器
    if (progressListener) {
      progressListener();
    }
    
    return { success: false, error: error.message };
  }
};
