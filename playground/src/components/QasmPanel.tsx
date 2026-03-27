import { useState } from 'react';

interface QasmPanelProps {
  qasm: string | null;
}

export default function QasmPanel({ qasm }: QasmPanelProps) {
  const [copied, setCopied] = useState(false);

  if (!qasm) {
    return (
      <div className="panel-empty">
        <strong>No compiled assembly yet</strong>
        <span>Compile the active program to inspect the emitted OpenQASM 2.0.</span>
      </div>
    );
  }

  const lines = qasm.trimEnd().split('\n');

  return (
    <div className="qasm-panel">
      <div className="qasm-panel__header">
        <div>
          <span className="panel-inline-label">Compiler output</span>
          <h3>OpenQASM 2.0</h3>
        </div>
        <div className="qasm-panel__actions">
          <span className="qasm-panel__meta">{lines.length} lines</span>
          <button
            className="button button--secondary button--compact"
            onClick={() => {
              navigator.clipboard.writeText(qasm);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            type="button"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="qasm-frame">
        <ol className="qasm-code">
          {lines.map((line, index) => (
            <li className="qasm-code__line" key={`${index}-${line}`}>
              <code>{line || ' '}</code>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
