import type { ThemeChartSpec } from './themeChart';

export interface ThemeSpec {
  colors?: Record<string, string>;
  fonts?: {
    major: string;
    minor: string;
  };
  chart?: ThemeChartSpec;
  logo?: string;
}
