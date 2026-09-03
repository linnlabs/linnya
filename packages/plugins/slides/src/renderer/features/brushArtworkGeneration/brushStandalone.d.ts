declare module 'p5.brush/standalone' {
  export const DEGREES: unique symbol;
  export function load(canvas: OffscreenCanvas): void;
  export function render(): void;
  export function clear(color?: string): void;
  export function seed(value: number): void;
  export function noiseSeed(value: number): void;
  export function angleMode(mode: typeof DEGREES): void;
  export function push(): void;
  export function pop(): void;
  export function translate(x: number, y: number): void;
  export function set(name: string, color: string, weight?: number): void;
  export function noStroke(): void;
  export function noField(): void;
  export function field(name: string): void;
  export function noFill(): void;
  export function noHatch(): void;
  export function noWash(): void;
  export function noMass(): void;
  export function line(x1: number, y1: number, x2: number, y2: number): void;
  export function flowLine(x: number, y: number, length: number, direction: number): void;
  export function spline(points: readonly [number, number, number][], curvature?: number): void;
  export function arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  export function beginShape(curvature?: number): void;
  export function vertex(x: number, y: number, pressure?: number): void;
  export function endShape(close?: boolean): void;
  export function rect(x: number, y: number, width: number, height: number, mode?: 'corner'): void;
  export function fill(color: string, opacity?: number): void;
  export function fillBleed(strength: number, direction?: 'in' | 'out', angle?: number): void;
  export function fillTexture(texture: number, border: number, scatter?: boolean): void;
  export function wash(color: string, opacity?: number): void;
  export function mass(
    name: string,
    color: string,
    options?: {
      precision?: number;
      strength?: number;
      gradient?: number;
      outline?: boolean;
    },
  ): void;
  export function hatch(
    distance: number,
    angle: number,
    options?: { rand?: number; continuous?: boolean; gradient?: number },
  ): void;
  export function hatchStyle(name: string, color: string, weight?: number): void;
}
