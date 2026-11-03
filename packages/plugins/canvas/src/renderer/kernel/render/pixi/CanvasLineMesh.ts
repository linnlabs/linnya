import { Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { CanvasCamera, CanvasEdge, CanvasPoint } from '../../../../shared';
import type { CanvasEdgeGeometry } from '../../geometry/canvasEdgeGeometry';

const vertex = `
in vec2 aPosition;
in vec2 aNormal;
in vec2 aOffset;
in float aSide;
uniform vec3 uCamera;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uFeather;
out float vDistance;
void main() {
  float halfWidth = uWidth * 0.5 + uFeather;
  vec2 position = aPosition * uCamera.z + uCamera.xy + aOffset + aNormal * halfWidth;
  gl_Position = vec4(position.x / uViewport.x * 2.0 - 1.0, 1.0 - position.y / uViewport.y * 2.0, 0.0, 1.0);
  vDistance = aSide * halfWidth;
}`;
const fragment = `
in float vDistance;
uniform vec3 uColor;
uniform float uWidth;
uniform float uFeather;
out vec4 finalColor;
void main() {
  float alpha = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + uFeather, abs(vDistance));
  finalColor = vec4(uColor * alpha, alpha);
}`;
const program = GlProgram.from({ vertex, fragment, name: 'canvas-screen-width-line' });

/** 世界顶点只在内容/远景档变化时上传；相机与1 CSS像素宽度由 uniform 计算。 */
export class CanvasLineMesh {
  private readonly uniforms = new UniformGroup({
    uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
    uViewport: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
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
      aSide: { buffer: new Float32Array(0), format: 'float32' } } });
  }
  setGeometry(entries: readonly { readonly edge: CanvasEdge; readonly geometry: CanvasEdgeGeometry }[], cacheKey?: string): void {
    const cached = cacheKey ? this.cached.get(cacheKey) : undefined;
    if (cached) {
      if (this.ownsGeometry) this.mesh.geometry.destroy(true);
      this.mesh.geometry = cached.geometry; this.mesh.visible = cached.visible; this.ownsGeometry = false; return;
    }
    const positions: number[] = [], normals: number[] = [], offsets: number[] = [], sides: number[] = [];
    const line = (a: CanvasPoint, b: CanvasPoint, offsetA: CanvasPoint = { x: 0, y: 0 }, offsetB: CanvasPoint = { x: 0, y: 0 }) => {
      const dx = b.x - a.x || offsetB.x - offsetA.x, dy = b.y - a.y || offsetB.y - offsetA.y;
      const length = Math.hypot(dx, dy);
      if (!length) return;
      for (const [endpoint, side] of [[0, 1], [0, -1], [1, 1], [1, 1], [0, -1], [1, -1]]) {
        const point = endpoint ? b : a, offset = endpoint ? offsetB : offsetA;
        positions.push(point.x, point.y); normals.push(-dy / length * side, dx / length * side);
        offsets.push(offset.x, offset.y); sides.push(side);
      }
    };
    const arrow = (tip: CanvasPoint, before: CanvasPoint) => {
      const angle = Math.atan2(tip.y - before.y, tip.x - before.x);
      // 箭头8×6.4屏幕像素；偏移不乘世界缩放。
      for (const side of [-1, 1]) line(tip, tip, { x: -Math.cos(angle) * 8 - Math.sin(angle) * side * 3.2,
        y: -Math.sin(angle) * 8 + Math.cos(angle) * side * 3.2 }, { x: 0, y: 0 });
    };
    for (const { edge, geometry } of entries) {
      const { points } = geometry;
      for (let i = 1; i < points.length; i++) line(points[i - 1], points[i]);
      if (edge.direction !== 'none' && points.length > 1) arrow(points[points.length - 1], points[points.length - 2]);
      if (edge.direction === 'both' && points.length > 1) arrow(points[0], points[1]);
    }
    const previous = this.mesh.geometry;
    this.mesh.geometry = new Geometry({ attributes: {
      aPosition: { buffer: new Float32Array(positions), format: 'float32x2' },
      aNormal: { buffer: new Float32Array(normals), format: 'float32x2' },
      aOffset: { buffer: new Float32Array(offsets), format: 'float32x2' },
      aSide: { buffer: new Float32Array(sides), format: 'float32' },
    } });
    this.mesh.visible = positions.length > 0;
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
  setCamera(camera: CanvasCamera, width: number, height: number, resolution: number): void {
    this.uniforms.uniforms.uCamera.set([camera.x, camera.y, camera.zoom]);
    this.uniforms.uniforms.uViewport.set([width, height]);
    this.uniforms.uniforms.uFeather = 0.5 / resolution;
    this.uniforms.update();
  }
  setColor(color: number, width = 1): void {
    this.uniforms.uniforms.uColor.set([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]);
    this.uniforms.uniforms.uWidth = width; this.uniforms.update();
  }
  destroy(): void { this.clearCache(); if (this.ownsGeometry) this.mesh.geometry.destroy(true); this.mesh.destroy(); this.shader.destroy(false); }
}
