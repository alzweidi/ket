import type { Program, Statement } from '../../../src/parser/ast.js';

const QUBIT_LABEL_WIDTH = 96;
const COLUMN_WIDTH = 74;
const QUBIT_SPACING = 54;
const TOP_PADDING = 44;
const BOTTOM_PADDING = 30;
const PADDING = 32;

interface CircuitVizProps {
  ast: Program | null;
}

interface Wire {
  name: string;
  index: number;
  label: string;
}

interface GatePlacement {
  label: string;
  wires: number[];
  column: number;
  kind: 'single' | 'multi' | 'measure' | 'algo';
}

export default function CircuitViz({ ast }: CircuitVizProps) {
  if (!ast) {
    return (
      <div className="panel-empty">
        <strong>No valid circuit available</strong>
        <span>Edit the program until it parses cleanly to render the circuit topology.</span>
      </div>
    );
  }

  const body = resolveCircuitBody(ast);
  const wires = collectWires(body);

  if (wires.length > 16) {
    return (
      <div className="panel-empty">
        <strong>Visualization limit reached</strong>
        <span>Circuits with more than 16 qubits are intentionally hidden to preserve readability.</span>
      </div>
    );
  }

  const placements = collectPlacements(body, wires);
  const width = QUBIT_LABEL_WIDTH + (placements.length + 1) * COLUMN_WIDTH + PADDING;
  const height = TOP_PADDING + wires.length * QUBIT_SPACING + BOTTOM_PADDING;
  const repeatBlocks = countRepeats(body);

  return (
    <div className="circuit-viz">
      <div className="circuit-viz__header">
        <div>
          <span className="panel-inline-label">Topology overview</span>
          <h3>Compiled circuit map</h3>
        </div>
        <div className="circuit-viz__metrics">
          <span>{wires.length} wire{pluralize(wires.length)}</span>
          <span>{placements.length} node{pluralize(placements.length)}</span>
          <span>{repeatBlocks} repeat block{pluralize(repeatBlocks)}</span>
        </div>
      </div>

      <div className="circuit-viz__legend">
        <span>
          <i className="legend-swatch legend-swatch--gate" />
          gates
        </span>
        <span>
          <i className="legend-swatch legend-swatch--algo" />
          algorithms
        </span>
        <span>
          <i className="legend-swatch legend-swatch--measure" />
          measurement
        </span>
        <span className="circuit-viz__annotation">Repeat blocks are expanded for inspection.</span>
      </div>

      <div className="circuit-board">
        <div className="circuit-scroll">
          <svg
            aria-label="Circuit visualization"
            height={height}
            role="img"
            viewBox={`0 0 ${Math.max(width, 640)} ${height}`}
            width={Math.max(width, 640)}
          >
            {wires.map((wire, index) => {
              const y = TOP_PADDING + index * QUBIT_SPACING;
              return (
                <g key={wire.label}>
                  <text className="circuit-wire-label" textAnchor="end" x={QUBIT_LABEL_WIDTH - 16} y={y + 4}>
                    {wire.label}
                  </text>
                  <line className="circuit-wire-line" x1={QUBIT_LABEL_WIDTH} x2={width - 24} y1={y} y2={y} />
                </g>
              );
            })}
            {placements.map((placement) => renderPlacement(placement))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function resolveCircuitBody(ast: Program): Statement[] {
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
    (node): node is Statement => node.kind !== 'run' && node.kind !== 'gate_def' && node.kind !== 'circuit_def'
  );
}

function collectWires(statements: Statement[]): Wire[] {
  const wires: Wire[] = [];
  for (const stmt of statements) {
    if (stmt.kind === 'qubit_decl') {
      const size = stmt.size ?? 1;
      for (let index = 0; index < size; index += 1) {
        wires.push({
          name: stmt.name,
          index,
          label: size === 1 ? stmt.name : `${stmt.name}[${index}]`
        });
      }
    }
  }
  return wires;
}

function collectPlacements(statements: Statement[], wires: Wire[]): GatePlacement[] {
  const placements: GatePlacement[] = [];
  let column = 0;

  const resolveWireIndex = (name: string, index: number | null) =>
    wires.findIndex((wire) => wire.name === name && wire.index === (index ?? 0));
  const expand = (name: string, index: number | null) =>
    index === null
      ? wires
          .filter((wire) => wire.name === name)
          .map((wire) => wires.findIndex((candidate) => candidate.label === wire.label))
      : [resolveWireIndex(name, index)];

  for (const stmt of statements) {
    switch (stmt.kind) {
      case 'gate_app':
        placements.push({
          label: stmt.gate,
          wires: stmt.targets.flatMap((target) => expand(target.name, target.index)).filter((value) => value >= 0),
          column: (column += 1),
          kind: stmt.targets.length > 1 ? 'multi' : 'single'
        });
        break;
      case 'param_gate_app':
        placements.push({
          label: stmt.gate,
          wires: expand(stmt.target.name, stmt.target.index).filter((value) => value >= 0),
          column: (column += 1),
          kind: 'single'
        });
        break;
      case 'builtin_algo':
      case 'phase_oracle':
        placements.push({
          label: stmt.kind === 'builtin_algo' ? stmt.algo.toUpperCase() : 'ORACLE',
          wires: expand(stmt.target.name, stmt.target.index).filter((value) => value >= 0),
          column: (column += 1),
          kind: 'algo'
        });
        break;
      case 'let_measure':
        placements.push({
          label: 'M',
          wires: expand(stmt.source.name, stmt.source.index).filter((value) => value >= 0),
          column: (column += 1),
          kind: 'measure'
        });
        break;
      case 'repeat':
        for (const nested of stmt.body) {
          placements.push(
            ...collectPlacements([nested], wires).map((placement) => ({
              ...placement,
              column: column + placement.column
            }))
          );
        }
        column = placements[placements.length - 1]?.column ?? column;
        break;
      default:
        break;
    }
  }

  return placements;
}

function countRepeats(statements: Statement[]): number {
  let repeats = 0;
  for (const stmt of statements) {
    if (stmt.kind === 'repeat') {
      repeats += 1 + countRepeats(stmt.body);
    }
    if (stmt.kind === 'if') {
      repeats += countRepeats(stmt.body);
    }
  }
  return repeats;
}

function renderPlacement(placement: GatePlacement) {
  const x = QUBIT_LABEL_WIDTH + placement.column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
  const topWire = Math.min(...placement.wires);
  const bottomWire = Math.max(...placement.wires);
  const topY = TOP_PADDING + topWire * QUBIT_SPACING;
  const bottomY = TOP_PADDING + bottomWire * QUBIT_SPACING;

  if (placement.kind === 'multi' && placement.wires.length > 1) {
    return (
      <g className="circuit-placement circuit-placement--multi" key={`${placement.label}-${placement.column}`}>
        <line className="circuit-connector" x1={x} x2={x} y1={topY} y2={bottomY} />
        {placement.wires.map((wire, index) => {
          const y = TOP_PADDING + wire * QUBIT_SPACING;
          if (index === placement.wires.length - 1 && placement.label === 'CNOT') {
            return (
              <g key={`${placement.label}-${wire}`}>
                <circle className="circuit-target" cx={x} cy={y} r="12" />
                <line className="circuit-target-mark" x1={x - 7} x2={x + 7} y1={y} y2={y} />
                <line className="circuit-target-mark" x1={x} x2={x} y1={y - 7} y2={y + 7} />
              </g>
            );
          }
          return <circle className="circuit-control" cx={x} cy={y} key={`${placement.label}-${wire}`} r="5.5" />;
        })}
      </g>
    );
  }

  const y = TOP_PADDING + ((topWire + bottomWire) / 2) * QUBIT_SPACING;
  const height = placement.kind === 'algo' ? Math.max((bottomWire - topWire + 1) * QUBIT_SPACING - 20, 40) : 34;
  const width = placement.kind === 'algo' ? 56 : 40;

  return (
    <g className={`circuit-placement circuit-placement--${placement.kind}`} key={`${placement.label}-${placement.column}`}>
      <rect className="circuit-node" height={height} rx={10} width={width} x={x - width / 2} y={placement.kind === 'algo' ? topY - 18 : y - 17} />
      <text className="circuit-node__text" dominantBaseline="middle" textAnchor="middle" x={x} y={placement.kind === 'algo' ? (topY + bottomY) / 2 : y}>
        {placement.label}
      </text>
      {placement.kind === 'measure' ? (
        <path className="circuit-measure-mark" d={`M ${x - 9} ${y + 7} Q ${x} ${y - 9} ${x + 9} ${y + 7}`} />
      ) : null}
    </g>
  );
}

function pluralize(value: number): string {
  return value === 1 ? '' : 's';
}
