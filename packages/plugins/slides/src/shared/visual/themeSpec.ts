import type { FontDeliveryTarget } from '../fontDelivery';
import type { ThemeChartSpec } from './themeChart';

export interface ThemeSpec {
  colors?: Record<string, string>;
  fonts?: {
    major: string;
    minor: string;
  };
  /** 字体面向的放映环境；缺省按 Office 通用字体检查。只影响检查与字体建议，不写入 PPTX。 */
  fontTarget?: FontDeliveryTarget;
  chart?: ThemeChartSpec;
  logo?: string;
}
