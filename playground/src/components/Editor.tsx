import MonacoEditor, { type Monaco } from '@monaco-editor/react';

const MONACO_OPTIONS = {
  theme: 'ket-lab',
  language: 'ket',
  fontSize: 15,
  lineHeight: 24,
  fontFamily: "'IBM Plex Mono', monospace",
  fontLigatures: true,
  minimap: { enabled: false },
  glyphMargin: false,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  smoothScrolling: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'bounded',
  wrappingIndent: 'same',
  renderWhitespace: 'selection',
  lineNumbersMinChars: 3,
  padding: { top: 24, bottom: 24 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  }
} as const;

interface EditorProps {
  source: string;
  onChange: (source: string) => void;
}

export default function Editor({ source, onChange }: EditorProps) {
  return (
    <div className="editor-surface">
      <MonacoEditor
        beforeMount={configureMonaco}
        options={MONACO_OPTIONS}
        onChange={(value) => onChange(value ?? '')}
        value={source}
      />
    </div>
  );
}

function configureMonaco(monaco: Monaco) {
  if (!monaco.languages.getLanguages().some((language) => language.id === 'ket')) {
    monaco.languages.register({ id: 'ket' });
  }

  monaco.languages.setMonarchTokensProvider('ket', {
    keywords: [
      'qubit',
      'bit',
      'gate',
      'circuit',
      'measure',
      'let',
      'run',
      'on',
      'ibm',
      'repeat',
      'if',
      'matches',
      'diffuse',
      'phase_oracle',
      'qft'
    ],
    gates: ['H', 'X', 'Y', 'Z', 'S', 'T', 'Rx', 'Ry', 'Rz', 'CNOT', 'CZ', 'SWAP', 'Toffoli', 'grover_diffuse'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/π/, 'number.float'],
        [/\|[01]*⟩/, 'string'],
        [/[0-9]+\.[0-9]+/, 'number.float'],
        [/[0-9]+/, 'number'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@gates': 'keyword.gate',
              '@keywords': 'keyword',
              '@default': 'identifier'
            }
          }
        ],
        [/[+\-*/=<>!]/, 'operator'],
        [/[{}()[\]]/, 'delimiter'],
        [/,/, 'delimiter']
      ]
    }
  });

  monaco.editor.defineTheme('ket-lab', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '95d7ff', fontStyle: 'bold' },
      { token: 'keyword.gate', foreground: 'ffc857' },
      { token: 'string', foreground: 'd4f5ff' },
      { token: 'number', foreground: 'f7b267' },
      { token: 'number.float', foreground: 'f7b267' },
      { token: 'comment', foreground: '7e95b1', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'e8eef9' },
      { token: 'operator', foreground: 'a7bad6' }
    ],
    colors: {
      'editor.background': '#08111c',
      'editor.foreground': '#e8eef9',
      'editorLineNumber.foreground': '#55677f',
      'editorLineNumber.activeForeground': '#d4e5ff',
      'editor.selectionBackground': '#17324d',
      'editor.inactiveSelectionBackground': '#10263c',
      'editorCursor.foreground': '#9dd7ff',
      'editorWhitespace.foreground': '#12263b',
      'editorIndentGuide.background1': '#112436',
      'editorIndentGuide.activeBackground1': '#295173'
    }
  });
}
