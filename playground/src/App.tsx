import { useEffect, useMemo, useState } from 'react';

import type { SimulationResult } from '../../src/interpreter/interpreter.js';
import type { Program, Statement } from '../../src/parser/ast.js';
import CircuitViz from './components/CircuitViz.js';
import Editor from './components/Editor.js';
import QasmPanel from './components/QasmPanel.js';
import ResultsPanel from './components/ResultsPanel.js';
import Toolbar from './components/Toolbar.js';
import { useKetWorker } from './hooks/useKetWorker.js';
import { useStore } from './store/useStore.js';

const EXAMPLES = {
  bell: `// Bell state: |Φ+⟩ = (|00⟩ + |11⟩) / √2
circuit bell_state() {
  qubit q[2]

  H q[0]
  CNOT q[0], q[1]

  let r = measure q
}

run bell_state()
`,
  grover: `// Grover's search: find |101⟩ in 3-qubit space
circuit grover(target: bitstring) {
  qubit q[3]

  H q[0]
  H q[1]
  H q[2]

  repeat 2 {
    phase_oracle q matches target
    diffuse q
  }

  let r = measure q
}

run grover(|101⟩)
`,
  qft: `// Quantum Fourier Transform on 4 qubits
circuit qft_example() {
  qubit q[4]
  X q[0]
  qft q
  let r = measure q
}

run qft_example()
`,
  teleportation: `// Quantum teleportation protocol (3 qubits)
circuit teleportation() {
  qubit q[3]
  H q[0]
  H q[1]
  CNOT q[1], q[2]
  CNOT q[0], q[1]
  H q[0]
  let c = measure q[0]
  let d = measure q[1]
  let r = measure q[2]
}

run teleportation()
`
} as const;

const PANEL_COPY = {
  circuit: {
    eyebrow: 'Circuit analysis',
    title: 'Execution Topology',
    description: 'Inspect register layout, gate placement, and compiled circuit flow.'
  },
  results: {
    eyebrow: 'Simulation output',
    title: 'State Distribution',
    description: 'Review sampled amplitudes, dominant outcomes, and measurement spread.'
  },
  qasm: {
    eyebrow: 'Generated assembly',
    title: 'OpenQASM Export',
    description: 'Audit the emitted QASM exactly as the compiler lowers the current program.'
  }
} as const;

const STATUS_COPY = {
  idle: 'Ready for analysis',
  running: 'Computing in worker',
  success: 'Latest result available',
  error: 'Attention required'
} as const;

type ExampleKey = keyof typeof EXAMPLES;

interface ProgramMetrics {
  lineCount: number;
  nonEmptyLineCount: number;
  circuits: number;
  targetName: string;
  qubits: number;
  gates: number;
  measurements: number;
  algorithms: number;
  repeats: number;
  qasmLines: number;
  dominantState: string | null;
  dominantProbability: number | null;
}

interface SummaryCard {
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'accent' | 'warm' | 'success';
}

export default function App() {
  const {
    source,
    setSource,
    status,
    setStatus,
    result,
    setResult,
    qasmOutput,
    setQasmOutput,
    error,
    setError,
    activePanel,
    setActivePanel,
    ast,
    setAst
  } = useStore();
  const [copied, setCopied] = useState(false);

  const initialSource = useMemo(() => {
    const encoded = new URLSearchParams(window.location.search).get('p');
    if (!encoded) {
      return EXAMPLES.bell;
    }
    try {
      return decodeSource(encoded);
    } catch {
      return EXAMPLES.bell;
    }
  }, []);

  useEffect(() => {
    setSource(initialSource);
  }, [initialSource, setSource]);

  const selectedExample = useMemo(() => {
    const entry = (Object.entries(EXAMPLES) as Array<[ExampleKey, string]>).find(
      ([, value]) => value === source
    );
    return entry?.[0] ?? null;
  }, [source]);

  const programMetrics = useMemo(
    () => buildProgramMetrics(ast, source, qasmOutput, result),
    [ast, qasmOutput, result, source]
  );

  const summaryCards = useMemo(
    () => buildSummaryCards(programMetrics, status, activePanel),
    [activePanel, programMetrics, status]
  );

  const activePanelCopy = PANEL_COPY[activePanel];

  const handleSourceChange = (nextSource: string) => {
    setSource(nextSource);
    setAst(null);
    setResult(null);
    setQasmOutput(null);
    setError(null);
    if (status !== 'running') {
      setStatus('idle');
    }
  };

  const { request } = useKetWorker((message) => {
    switch (message.action) {
      case 'run_result':
        setResult(message.result);
        setStatus('success');
        setError(null);
        setActivePanel('results');
        return;
      case 'compile_result':
        setQasmOutput(message.qasm);
        setStatus('success');
        setError(null);
        setActivePanel('qasm');
        return;
      case 'parse_result':
        setAst(message.ast);
        setStatus('idle');
        setError(null);
        return;
      case 'error':
        setError(message.message);
        setStatus('error');
        return;
    }
  });

  useEffect(() => {
    const handle = window.setTimeout(() => {
      request({ action: 'parse', source });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [request, source]);

  return (
    <div className="app-shell">
      <div aria-hidden="true" className="app-shell__noise" />

      <Toolbar
        copied={copied}
        metrics={programMetrics}
        onCompile={() => {
          setStatus('running');
          request({ action: 'compile', source });
        }}
        onExampleChange={(value) => {
          const nextSource = EXAMPLES[value as ExampleKey] ?? EXAMPLES.bell;
          handleSourceChange(nextSource);
          setActivePanel('circuit');
        }}
        onRun={() => {
          setStatus('running');
          request({ action: 'run', source });
        }}
        onShare={async () => {
          try {
            const encoded = encodeSource(source);
            if (encoded.length > 4000) {
              setError('Program too long to share via URL. Download the .ket file instead.');
              return;
            }
            await navigator.clipboard.writeText(
              `${window.location.origin}${window.location.pathname}?p=${encoded}`
            );
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          } catch {
            setError('Clipboard access is unavailable in this browser context.');
          }
        }}
        selectedExample={selectedExample}
        status={status}
      />

      <section aria-label="Program summary" className="summary-strip">
        {summaryCards.map((card) => (
          <article className={`summary-card summary-card--${card.tone}`} key={card.label}>
            <span className="summary-card__label">{card.label}</span>
            <strong className="summary-card__value">{card.value}</strong>
            <span className="summary-card__detail">{card.detail}</span>
          </article>
        ))}
      </section>

      <main className="workspace-grid">
        <section className="panel panel--editor">
          <div className="panel__masthead">
            <div>
              <span className="panel__eyebrow">Authoring surface</span>
              <h2 className="panel__title">Source Program</h2>
              <p className="panel__description">
                Compose Ket code with live structural validation and an instrument-grade editor
                tuned for dense technical work.
              </p>
            </div>
            <div className="panel__status-stack">
              <span className={`status-pill status-pill--${status}`}>{STATUS_COPY[status]}</span>
              <span className="panel__meta-note">
                {programMetrics.nonEmptyLineCount} active lines · {programMetrics.targetName}
              </span>
            </div>
          </div>

          <div className="panel__editor-wrap">
            <Editor source={source} onChange={handleSourceChange} />
          </div>

          {error ? (
            <div className="feedback feedback--error" role="alert">
              <span className="feedback__label">Compiler report</span>
              <p>{error}</p>
            </div>
          ) : (
            <div className="feedback feedback--neutral" role="status">
              <span className="feedback__label">Local validation</span>
              <p>
                Parse and type checks run in a background worker as you edit, keeping the
                workspace responsive while preserving immediate feedback.
              </p>
            </div>
          )}
        </section>

        <section className="panel panel--analysis">
          <div className="panel__masthead panel__masthead--analysis">
            <div>
              <span className="panel__eyebrow">{activePanelCopy.eyebrow}</span>
              <h2 className="panel__title">{activePanelCopy.title}</h2>
              <p className="panel__description">{activePanelCopy.description}</p>
            </div>
            <div aria-label="Output panels" className="panel-tabs" role="tablist">
              {(['circuit', 'results', 'qasm'] as const).map((panel) => (
                <button
                  aria-selected={panel === activePanel}
                  className={panel === activePanel ? 'is-active' : ''}
                  key={panel}
                  onClick={() => setActivePanel(panel)}
                  role="tab"
                  type="button"
                >
                  <span>{panel === 'qasm' ? 'OpenQASM' : panel}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel__body">
            {activePanel === 'circuit' ? <CircuitViz ast={ast} /> : null}
            {activePanel === 'results' ? <ResultsPanel result={result} /> : null}
            {activePanel === 'qasm' ? <QasmPanel qasm={qasmOutput} /> : null}
          </div>
        </section>
      </main>

      <footer className="status-rail">
        <div className="status-rail__group">
          <span className={`status-dot status-dot--${status}`} />
          <span>{STATUS_COPY[status]}</span>
        </div>
        <div className="status-rail__group">
          <span>UTF-8 source</span>
          <span>Local worker execution</span>
          <span>OpenQASM 2.0 export</span>
        </div>
      </footer>
    </div>
  );
}

function encodeSource(source: string): string {
  return btoa(unescape(encodeURIComponent(source)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeSource(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(normalized)));
}

function buildProgramMetrics(
  ast: Program | null,
  source: string,
  qasmOutput: string | null,
  result: SimulationResult | null
): ProgramMetrics {
  const lineCount = source.split(/\r?\n/).length;
  const nonEmptyLineCount = source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  const circuits =
    ast?.body.filter((node) => node.kind === 'circuit_def').length ?? 0;
  const statements = ast ? resolveEntryStatements(ast) : [];
  const counts = countStatements(statements);
  const dominantEntry = result
    ? [...result.probabilities.entries()].sort((left, right) => right[1] - left[1])[0] ?? null
    : null;

  return {
    lineCount,
    nonEmptyLineCount,
    circuits,
    targetName: resolveTargetName(ast),
    qasmLines: qasmOutput ? qasmOutput.trim().split('\n').length : 0,
    dominantState: dominantEntry?.[0] ?? null,
    dominantProbability: dominantEntry?.[1] ?? null,
    ...counts
  };
}

function buildSummaryCards(
  metrics: ProgramMetrics,
  status: keyof typeof STATUS_COPY,
  activePanel: keyof typeof PANEL_COPY
): SummaryCard[] {
  return [
    {
      label: 'Program scope',
      value: `${metrics.nonEmptyLineCount} lines`,
      detail: `${metrics.circuits} circuit def${pluralize(metrics.circuits)} · target ${metrics.targetName}`,
      tone: 'neutral'
    },
    {
      label: 'Quantum surface',
      value: `${metrics.qubits} qubit${pluralize(metrics.qubits)}`,
      detail: `${metrics.gates} gate op${pluralize(metrics.gates)} · ${metrics.measurements} measurement${pluralize(metrics.measurements)}`,
      tone: 'accent'
    },
    {
      label: 'Execution lane',
      value: STATUS_COPY[status],
      detail:
        metrics.qasmLines > 0
          ? `${metrics.qasmLines} QASM lines generated`
          : 'Awaiting compile output',
      tone: status === 'success' ? 'success' : status === 'error' ? 'warm' : 'neutral'
    },
    {
      label: activePanel === 'results' ? 'Dominant state' : activePanel === 'qasm' ? 'Assembly surface' : 'Circuit analysis',
      value:
        activePanel === 'results' && metrics.dominantState
          ? `|${metrics.dominantState}⟩`
          : activePanel === 'qasm'
            ? `${metrics.qasmLines || 0} lines`
            : `${metrics.gates + metrics.algorithms + metrics.measurements} nodes`,
      detail:
        activePanel === 'results' && metrics.dominantProbability !== null
          ? `${(metrics.dominantProbability * 100).toFixed(1)}% peak probability`
          : activePanel === 'qasm'
            ? 'Lowered directly from the current program'
            : `${metrics.algorithms} algorithm op${pluralize(metrics.algorithms)} · ${metrics.repeats} repeat block${pluralize(metrics.repeats)}`,
      tone: activePanel === 'qasm' ? 'warm' : 'neutral'
    }
  ];
}

function resolveTargetName(ast: Program | null): string {
  const run = ast?.body.find((node) => node.kind === 'run');
  if (!run || run.kind !== 'run') {
    return 'top-level';
  }
  return run.circuit;
}

function resolveEntryStatements(ast: Program): Statement[] {
  const run = ast.body.find((node) => node.kind === 'run');
  if (run && run.kind === 'run') {
    const circuit = ast.body.find(
      (node) => node.kind === 'circuit_def' && node.name === run.circuit
    );
    if (circuit && circuit.kind === 'circuit_def') {
      return circuit.body;
    }
  }

  return ast.body.filter(
    (node): node is Statement =>
      node.kind !== 'run' && node.kind !== 'gate_def' && node.kind !== 'circuit_def'
  );
}

function countStatements(statements: Statement[]): Omit<
  ProgramMetrics,
  'lineCount' | 'nonEmptyLineCount' | 'circuits' | 'targetName' | 'qasmLines' | 'dominantState' | 'dominantProbability'
> {
  const counts = {
    qubits: 0,
    gates: 0,
    measurements: 0,
    algorithms: 0,
    repeats: 0
  };

  const walk = (items: Statement[]) => {
    for (const stmt of items) {
      switch (stmt.kind) {
        case 'qubit_decl':
          counts.qubits += stmt.size ?? 1;
          break;
        case 'gate_app':
        case 'param_gate_app':
        case 'user_gate_call':
          counts.gates += 1;
          break;
        case 'builtin_algo':
        case 'phase_oracle':
          counts.algorithms += 1;
          break;
        case 'let_measure':
          counts.measurements += 1;
          break;
        case 'repeat':
          counts.repeats += 1;
          walk(stmt.body);
          break;
        case 'if':
          walk(stmt.body);
          break;
        case 'bit_decl':
          break;
      }
    }
  };

  walk(statements);
  return counts;
}

function pluralize(value: number): string {
  return value === 1 ? '' : 's';
}
