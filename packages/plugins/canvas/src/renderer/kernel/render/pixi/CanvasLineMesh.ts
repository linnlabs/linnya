import { Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { CanvasCamera, CanvasEdge, CanvasPoint, CanvasColor, CanvasLinePalette } from '../../../../shared';
import type { CanvasEdgeGeometry } from '../../geometry/canvasEdgeGeometry';

const vertex = `
precision highp float;
in vec2 aPosition;
in vec2 aNormal;
in vec2 aOffset;
in float aSide;
in float aDistance;
in float aPattern;
in float aColorIndex;
uniform vec3 uLineColor;
uniform vec3 uRed;
uniform vec3 uOrange;
uniform vec3 uYellow;
uniform vec3 uGreen;
uniform vec3 uCyan;
uniform vec3 uPurple;
uniform float uUsePalette;
out vec3 vColor;
uniform vec3 uCamera;
uniform mat3 uProjectionMatrix;
uniform float uWidth;
uniform float uFeather;
out float vDistance;
out float vLength;
out float vPattern;
void main() {
  float halfWidth = uWidth * 0.5 + uFeather;
  vec2 position = aPosition * uCamera.z + uCamera.xy + aOffset + aNormal * halfWidth;
  // Pixi projection 同时处理主窗口与离屏extract目标的Y方向，不能手写NDC翻转。
  gl_Position = vec4((uProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vDistance = aSide * halfWidth;
  vLength = aDistance * uCamera.z;
  vPattern = aPattern;
  vColor = uLineColor;
  if (uUsePalette > 0.5) {
    if (aColorIndex > 5.5) vColor = uPurple;
    else if (aColorIndex > 4.5) vColor = uCyan;
    else if (aColorIndex > 3.5) vColor = uGreen;
    else if (aColorIndex > 2.5) vColor = uYellow;
    else if (aColorIndex > 1.5) vColor = uOrange;
    else if (aColorIndex > 0.5) vColor = uRed;
  }
}`;
const fragment = `
precision highp float;
in float vDistance;
in float vLength;
in float vPattern;
in vec3 vColor;
uniform float uWidth;
uniform float uFeather;
out vec4 finalColor;
void main() {
  float alpha = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + uFeather, abs(vDistance));
  if (vPattern > 0.5) alpha *= 1.0 - smoothstep(4.5, 5.0, mod(vLength, 9.0));
  finalColor = vec4(vColor * alpha, alpha);
}`;
const program = GlProgram.from({ vertex, fragment, name: 'canvas-screen-width-line' });
const colorIndices: Readonly<Record<CanvasColor, number>> = { white: 0, red: 1, orange: 2, yellow: 3, green: 4, cyan: 5, purple: 6 };
const lineVertices = [[0, 1], [0, -1], [1, 1], [1, 1], [0, -1], [1, -1]] as const;

/** 世界顶点只在内容/远景档变化时上传；相机与1 CSS像素宽度由 uniform 计算。 */
export class CanvasLineMesh {
  private readonly uniforms = new UniformGroup({
    uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
    uLineColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
    uRed: { value: new Float32Array(3), type: 'vec3<f32>' }, uOrange: { value: new Float32Array(3), type: 'vec3<f32>' },
    uYellow: { value: new Float32Array(3), type: 'vec3<f32>' }, uGreen: { value: new Float32Array(3), type: 'vec3<f32>' },
    uCyan: { value: new Float32Array(3), type: 'vec3<f32>' }, uPurple: { value: new Float32Array(3), type: 'vec3<f32>' },
    uUsePalette: { value: 0, type: 'f32' },
    uWidth: { value: 1, type: 'f32' }, uFeather: { value: 0.5, type: 'f32' },
  });
  private readonly shader = new Shader({ glProgram: program, resources: { lineUniforms: this.uniforms } });
  readonly mesh = new Mesh({ geometry: this.empty(), shader: this.shader });
  private ownsGeometry = true;
  private readonly cached = new Map<string, { readonly geometry: Geometry; readonly visible: boolean }>();
  constructor() { this.mesh.visible = false; }
  private empty(): Geometry {
    return new Geometry({ attributes: { aPosition: { buffer: new Float32Array(0), format: 'float32x2' },
      aNormal: { buffer: new Float32Array(0), format: 'float32x2' }, aOffset: { buffer: new Float32Array(0), format: 'float32x2' },
      aSide: { buffer: new Float32Array(0), format: 'float32' }, aDistance: { buffer: new Float32Array(0), format: 'float32' },
      aPattern: { buffer: new Float32Array(0), format: 'float32' }, aColorIndex: { buffer: new Float32Array(0), format: 'float32' } } });
  }
  setGeometry(entries: readonly { readonly edge: CanvasEdge; readonly geometry: CanvasEdgeGeometry }[], cacheKey?: string): void {
    const cached = cacheKey ? this.cached.get(cacheKey) : undefined;
    if (cached) {
      if (this.ownsGeometry) this.mesh.geometry.destroy(true);
      this.mesh.geometry = cached.geometry; this.mesh.visible = cached.visible; this.ownsGeometry = false; return;
    }
    const segments = entries.reduce((sum, entry) => sum + Math.max(0, entry.geometry.points.length - 1)
      + (entry.geometry.points.length > 1 ? entry.edge.direction === 'both' ? 4 : entry.edge.direction === 'none' ? 0 : 2 : 0), 0);
    const positions = new Float32Array(segments * 12), normals = new Float32Array(segments * 12), offsets = new Float32Array(segments * 12);
    const sides = new Float32Array(segments * 6), distances = new Float32Array(segments * 6), patterns = new Float32Array(segments * 6), colors = new Float32Array(segments * 6);
    let cursor = 0;
    const zero = { x: 0, y: 0 }, segment = { offsetA: zero, offsetB: zero, start: 0, dashed: false, colorIndex: 0 };
    const line = (a: CanvasPoint, b: CanvasPoint) => {
      const { offsetA, offsetB, start, dashed } = segment;
      const dx = b.x - a.x || offsetB.x - offsetA.x, dy = b.y - a.y || offsetB.y - offsetA.y;
      const length = Math.hypot(dx, dy);
      if (!length) return;
      for (let index = 0; index < lineVertices.length; index++) {
        const endpoint = lineVertices[index][0], side = lineVertices[index][1];
        const point = endpoint ? b : a, offset = endpoint ? offsetB : offsetA;
        positions[cursor * 2] = point.x; positions[cursor * 2 + 1] = point.y;
        normals[cursor * 2] = -dy / length * side; normals[cursor * 2 + 1] = dx / length * side;
        offsets[cursor * 2] = offset.x; offsets[cursor * 2 + 1] = offset.y; sides[cursor] = side;
        distances[cursor] = start + (endpoint ? length : 0); patterns[cursor] = dashed ? 1 : 0; colors[cursor] = segment.colorIndex; cursor++;
      }
    };
    const arrow = (tip: CanvasPoint, before: CanvasPoint) => {
      const angle = Math.atan2(tip.y - before.y, tip.x - before.x);
      // 箭头8×6.4屏幕像素；偏移不乘世界缩放。
      segment.start = 0; segment.dashed = false; segment.offsetB = zero;
      for (const side of [-1, 1]) {
        segment.offsetA = { x: -Math.cos(angle) * 8 - Math.sin(angle) * side * 3.2, y: -Math.sin(angle) * 8 + Math.cos(angle) * side * 3.2 };
        line(tip, tip);
      }
    };
    for (const { edge, geometry } of entries) {
      const { points } = geometry; segment.colorIndex = colorIndices[edge.color];
      let distance = 0;
      segment.offsetA = zero; segment.offsetB = zero; segment.dashed = edge.linePattern === 'dashed';
      for (let i = 1; i < points.length; i++) {
        segment.start = distance; line(points[i - 1], points[i]);
        distance += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      if (edge.direction !== 'none' && points.length > 1) arrow(points[points.length - 1], points[points.length - 2]);
      if (edge.direction === 'both' && points.length > 1) arrow(points[0], points[1]);
    }
    const previous = this.mesh.geometry;
    this.mesh.geometry = new Geometry({ attributes: {
      aPosition: { buffer: positions.subarray(0, cursor * 2), format: 'float32x2' },
      aNormal: { buffer: normals.subarray(0, cursor * 2), format: 'float32x2' },
      aOffset: { buffer: offsets.subarray(0, cursor * 2), format: 'float32x2' },
      aSide: { buffer: sides.subarray(0, cursor), format: 'float32' },
      aDistance: { buffer: distances.subarray(0, cursor), format: 'float32' },
      aPattern: { buffer: patterns.subarray(0, cursor), format: 'float32' },
      aColorIndex: { buffer: colors.subarray(0, cursor), format: 'float32' },
    } });
    this.mesh.visible = cursor > 0;
    if (this.ownsGeometry) previous.destroy(true);
    this.ownsGeometry = !cacheKey;
    if (cacheKey) this.cached.set(cacheKey, { geometry: this.mesh.geometry, visible: this.mesh.visible });
  }
  clearCache(): void {
    for (const value of this.cached.values()) value.geometry.destroy(true);
    this.cached.clear();
  }
  shareGeometry(source: CanvasLineMesh): void {
    if (this.ownsGeometry) this.mesh.geometry.destroy(true);
    this.mesh.geometry = source.mesh.geometry;
    this.mesh.visible = source.mesh.visible; this.ownsGeometry = false;
  }
  setCamera(camera: CanvasCamera, resolution: number): void {
    this.uniforms.uniforms.uCamera.set([camera.x, camera.y, camera.zoom]);
    this.uniforms.uniforms.uFeather = 0.5 / resolution;
    this.uniforms.update();
  }
  setColor(color: number, width = 1, palette?: CanvasLinePalette): void {
    this.uniforms.uniforms.uLineColor.set([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]);
    this.uniforms.uniforms.uUsePalette = palette ? 1 : 0;
    if (palette) {
      const apply = (target: Float32Array, color: number) => target.set([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]);
      apply(this.uniforms.uniforms.uRed, palette.red); apply(this.uniforms.uniforms.uOrange, palette.orange);
      apply(this.uniforms.uniforms.uYellow, palette.yellow); apply(this.uniforms.uniforms.uGreen, palette.green);
      apply(this.uniforms.uniforms.uCyan, palette.cyan); apply(this.uniforms.uniforms.uPurple, palette.purple);
    }
    this.uniforms.uniforms.uWidth = width; this.uniforms.update();
  }
  destroy(): void { this.clearCache(); if (this.ownsGeometry) this.mesh.geometry.destroy(true); this.mesh.destroy(); this.shader.destroy(false); }
}
