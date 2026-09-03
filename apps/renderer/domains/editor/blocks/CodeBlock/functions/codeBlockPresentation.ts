import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';

interface CodeLanguageDefinition {
  readonly value: string;
  readonly label: string;
}

const TECHNICAL_LANGUAGE_DEFINITIONS: readonly CodeLanguageDefinition[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'js', label: 'JS' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'ts', label: 'TS' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'markdown', label: 'Markdown' },
] as const;

export function readCodeBlockLanguageOptions(
  editorMessage: EditorMessageResolver,
): readonly CustomSelectOption[] {
  return [
    { value: 'plaintext', text: editorMessage('editor.codeBlock.language.plainText') },
    ...TECHNICAL_LANGUAGE_DEFINITIONS.map((language) => ({
      value: language.value,
      text: language.label,
    })),
  ];
}
