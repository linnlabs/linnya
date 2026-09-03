/**
 * Prettier代码格式化配置
 * 
 * 功能 (What): 统一的代码格式化规则
 * 输入 (Input): 源代码文件
 * 输出 (Output): 格式化后的代码
 * 副作用 (Side-effects): 修改文件格式
 */

module.exports = {
  // 基础格式化配置
  printWidth: 100,           // 行宽限制
  tabWidth: 2,               // 缩进宽度
  useTabs: false,            // 使用空格而非制表符
  semi: true,                // 语句末尾分号
  singleQuote: true,         // 使用单引号
  quoteProps: 'as-needed',   // 对象属性引号按需添加
  
  // JSX配置
  jsxSingleQuote: true,      // JSX中使用单引号
  
  // 尾随逗号
  trailingComma: 'es5',      // ES5兼容的尾随逗号
  
  // 大括号空格
  bracketSpacing: true,      // 对象大括号内空格
  bracketSameLine: false,    // 多行JSX闭合标签独立成行
  
  // 箭头函数参数
  arrowParens: 'avoid',      // 单参数箭头函数省略括号
  
  // Vue文件支持
  vueIndentScriptAndStyle: false,
  
  // 换行符
  endOfLine: 'lf',           // 统一使用LF换行符
  
  // HTML空格敏感度
  htmlWhitespaceSensitivity: 'css',
  
  // 嵌入代码格式化
  embeddedLanguageFormatting: 'auto',
  
  // 文件覆盖配置
  overrides: [
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always'
      }
    },
    {
      files: '*.json',
      options: {
        printWidth: 120
      }
    },
    {
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false
      }
    }
  ]
}; 