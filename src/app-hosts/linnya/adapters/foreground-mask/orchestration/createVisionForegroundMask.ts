import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ForegroundMaskPort, ForegroundMaskResult } from 'src/domains/image-processing';
import { VISION_FOREGROUND_SCRIPT } from '../definitions/visionForegroundScript';

/** macOS 14 对应 Darwin 23；前景实例遮罩从这一版才有。 */
const MIN_DARWIN_MAJOR = 23;
/** 2400px 的图实测 0.2–0.3 秒；首次调用要加载系统模型，留足余量。 */
const TIMEOUT_MS = 60_000;
const MAX_ERROR_CHARACTERS = 300;

function isVisionAvailable(): boolean {
  return process.platform === 'darwin' && Number(os.release().split('.')[0]) >= MIN_DARWIN_MAJOR;
}

function runScript(args: readonly string[], signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', VISION_FOREGROUND_SCRIPT, ...args], {
      signal, timeout: TIMEOUT_MS, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error && (signal.aborted || typeof error.code !== 'number')) {
        // 取消、超时被杀、找不到 osascript 都不是脚本自己报的错，原样抛给调用方
        reject(error);
        return;
      }
      resolve({ code: error && typeof error.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
}

/**
 * Vision 前景遮罩：输入写进临时目录，调 osascript，读回 PNG，最后删掉临时目录。
 * 错误信息里的临时路径替换掉，不把本机路径交给模型。
 */
export function createVisionForegroundMask(): ForegroundMaskPort {
  return {
    available: isVisionAvailable(),
    async mask({ jpeg, signal }): Promise<ForegroundMaskResult> {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-foreground-'));
      try {
        const inputPath = path.join(directory, 'input.jpg');
        const outputPath = path.join(directory, 'mask.png');
        await writeFile(inputPath, jpeg);
        const result = await runScript([inputPath, outputPath], signal);
        if (result.code !== 0) {
          const reason = result.stderr.split(directory).join('…').trim().slice(0, MAX_ERROR_CHARACTERS);
          return { status: 'failed', message: `系统前景遮罩运行失败（osascript 退出码 ${result.code}）：${reason}` };
        }
        const report: unknown = JSON.parse(result.stdout);
        if (typeof report !== 'object' || report === null || !('instances' in report) || typeof report.instances !== 'number') {
          return { status: 'failed', message: `系统前景遮罩的输出无法识别：${result.stdout.trim().slice(0, MAX_ERROR_CHARACTERS)}` };
        }
        if (report.instances === 0) return { status: 'no_foreground' };
        return { status: 'ok', png: new Uint8Array(await readFile(outputPath)) };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
