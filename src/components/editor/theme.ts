import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { LanguageId } from '@/lib/file-tree';

const forgeTheme = EditorView.theme(
  {
    '&.cm-editor': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
    },
    '&.cm-editor.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontSize: '12.75px',
      lineHeight: '1.7',
    },
    '.cm-content': {
      padding: '14px 0 45vh',
      caretColor: 'var(--accent)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#46524d',
      border: 'none',
      borderRight: '1px solid var(--line)',
      paddingLeft: '10px',
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 4px',
      minWidth: '28px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(182, 242, 74, 0.035)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--accent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(182, 242, 74, 0.16) !important',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
      borderLeftWidth: '1.5px',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(182, 242, 74, 0.14)',
      outline: '1px solid rgba(182, 242, 74, 0.35)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel-2)',
      border: '1px solid var(--line-strong)',
      borderRadius: '6px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--panel-2)',
      border: '1px solid var(--line-strong)',
      color: 'var(--muted)',
    },
  },
  { dark: true }
);

const LANGUAGE_EXTENSIONS: Record<LanguageId, () => Extension[]> = {
  typescript: () => [javascript({ typescript: true })],
  typescriptreact: () => [javascript({ jsx: true, typescript: true })],
  javascript: () => [javascript()],
  javascriptreact: () => [javascript({ jsx: true })],
  css: () => [css()],
  html: () => [html()],
  json: () => [json()],
  markdown: () => [markdown()],
  text: () => [],
};

/** Theme extensions (syntax + chrome). */
export const editorTheme: Extension = [oneDark, forgeTheme];

/** Language support for a given file type. */
export function languageExtensions(language: LanguageId): Extension[] {
  return LANGUAGE_EXTENSIONS[language]();
}
