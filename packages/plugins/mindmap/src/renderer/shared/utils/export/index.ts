import { toPng, toSvg } from 'html-to-image'
import type { MindMapInstance } from '../../../domain/types/index'

const filter = (node: HTMLElement) => {
  const classList = node.classList
  if (!classList) return true
  // 过滤掉不需要导出的元素，比如辅助线或控制柄（如果需要的话）
  return true
}

const downloadFile = (dataUrl: string, filename: string) => {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const resolveExportBackgroundColor = (container: HTMLElement) => (
  getComputedStyle(container).backgroundColor
)

export const exportPng = async function (this: MindMapInstance, filename = 'mindmap.png') {
  if (!this.container) return
  
  try {
    // 临时调整样式以确保完整捕获（例如移除滚动条影响）
    // html-to-image 支持通过 style 选项传入覆盖样式
    const dataUrl = await toPng(this.container, {
      backgroundColor: resolveExportBackgroundColor(this.container),
      filter,
      // 增加像素比以提高清晰度
      pixelRatio: 2,
    })
    downloadFile(dataUrl, filename)
  } catch (error) {
    console.error('Export PNG failed:', error)
  }
}

export const exportSvg = async function (this: MindMapInstance, filename = 'mindmap.svg') {
  if (!this.container) return

  try {
    const dataUrl = await toSvg(this.container, {
      backgroundColor: resolveExportBackgroundColor(this.container),
      filter,
    })
    downloadFile(dataUrl, filename)
  } catch (error) {
    console.error('Export SVG failed:', error)
  }
}
