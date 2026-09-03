import { Router, Request, Response } from 'express';
const fetch = require('node-fetch');

const router = Router();

/**
 * @route POST /api/v1/ollama/tags
 * @description 代理前端请求到指定的 Ollama 服务以获取模型列表。
 * @body { api_url: string } - Ollama 服务的 URL (例如 "http://localhost:11434")
 * @returns {Promise<Response>} - 返回从 Ollama 服务获取的模型列表或错误信息。
 */
router.post('/tags', async (req: Request, res: Response) => {
  const { api_url } = req.body;

  if (!api_url) {
    return res.status(400).json({ detail: '`api_url` is required.' });
  }

  try {
    // 构造目标 URL
    // Ollama 获取模型列表的端点是 /api/tags
    const targetUrl = new URL('/api/tags', api_url).toString();
    
    // 向 Ollama 服务发起请求
    const response = await fetch(targetUrl, {
      method: 'GET', // 获取 tags 是 GET 请求
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 检查响应状态
    if (!response.ok) {
      const errorText = await response.text();
      // 返回一个更具体的错误信息，包括状态码和从Ollama收到的消息
      return res.status(response.status).json({ 
        detail: `Failed to fetch models from Ollama. Status: ${response.status}. Response: ${errorText}` 
      });
    }

    // 解析响应并返回给前端
    const data = await response.json();
    
    // 从返回的数据中提取模型名称列表
    // Ollama /api/tags 返回的结构是 { models: [{ name: "model1:latest", ... }, ...] }
    const modelNames = data.models.map((model: any) => model.name);
    
    // 返回只包含模型名称的数组
    return res.status(200).json({ models: modelNames });

  } catch (error: any) {
    console.error(`[Ollama Router] Error proxying /api/tags request:`, error);
    
    let detail = 'An unknown error occurred while contacting the Ollama service.';
    if (error.code === 'ECONNREFUSED') {
      detail = `Connection refused. Please ensure Ollama is running at ${api_url}.`;
    } else if (error.name === 'FetchError') { // node-fetch special error
      detail = `Failed to fetch from the Ollama API. Reason: ${error.message}`;
    } else if (error.cause?.code === 'ENOTFOUND') {
      detail = `The address for the Ollama service could not be found: ${api_url}. Please check the URL.`
    }

    return res.status(500).json({ detail });
  }
});

export default router;
