interface ToolbarProps {
  copied: boolean;
  metrics: {
    targetName: string;
    qubits: number;
    gates: number;
    measurements: number;
  };
  onRun: () => void;
  onCompile: () => void;
  onShare: () => void;
  onExampleChange: (value: string) => void;
  selectedExample: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
}

const STATUS_LABEL = {
  idle: 'Ready',
  running: 'Running',
  success: 'Synced',
  error: 'Error'
} as const;

export default function Toolbar({
  copied,
  metrics,
  onRun,
  onCompile,
  onShare,
  onExampleChange,
  selectedExample,
  status
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__identity">
        <div aria-hidden="true" className="toolbar__mark">
          <svg fill="none" viewBox="0 0 48 48">
            <rect height="46" rx="16" width="46" x="1" y="1" />
            <path d="M16 32V16l7 8-7 8Z" />
            <circle cx="31" cy="17" r="3.5" />
            <circle cx="31" cy="31" r="3.5" />
            <path d="M31 20.5V27.5" />
          </svg>
        </div>
        <div className="toolbar__copy">
          <span className="toolbar__eyebrow">Quantum language workbench</span>
          <div className="toolbar__title-row">
            <h1>Ket Playground</h1>
            <span className={`toolbar__status toolbar__status--${status}`}>{STATUS_LABEL[status]}</span>
          </div>
          <p>
            Research-grade authoring and inspection for Ket programs, with circuit topology,
            state distribution, and OpenQASM export in a single workspace.
          </p>
        </div>
      </div>

      <div className="toolbar__controls">
        <label className="toolbar__field">
          <span className="toolbar__field-label">Example program</span>
          <select
            aria-label="Example program"
            onChange={(event) => onExampleChange(event.target.value)}
            value={selectedExample ?? 'custom'}
          >
            <option disabled value="custom">
              Custom program
            </option>
            <option value="bell">Bell State</option>
            <option value="grover">Grover&apos;s Search</option>
            <option value="qft">QFT</option>
            <option value="teleportation">Teleportation</option>
          </select>
        </label>

        <div className="toolbar__meta-card">
          <span className="toolbar__meta-label">Loaded target</span>
          <strong>{metrics.targetName}</strong>
          <span className="toolbar__meta-detail">
            {metrics.qubits}q · {metrics.gates} ops · {metrics.measurements} meas
          </span>
        </div>

        <div className="toolbar__actions">
          <button
            className="button button--ghost"
            disabled={status === 'running'}
            onClick={onCompile}
            type="button"
          >
            Compile
          </button>
          <button
            className="button button--primary"
            disabled={status === 'running'}
            onClick={onRun}
            type="button"
          >
            Run
          </button>
          <button className="button button--secondary" onClick={onShare} type="button">
            {copied ? 'Copied link' : 'Share'}
          </button>
        </div>
      </div>
    </header>
  );
}
