import type { SimulationResult } from '../../../src/interpreter/interpreter.js';

interface ResultsPanelProps {
  result: SimulationResult | null;
}

export default function ResultsPanel({ result }: ResultsPanelProps) {
  if (!result) {
    return (
      <div className="panel-empty">
        <strong>No simulation output yet</strong>
        <span>Run the active Ket program to inspect sampled state probabilities.</span>
      </div>
    );
  }

  const entries = [...result.probabilities.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24);
  const max = entries[0]?.[1] ?? 1;
  const totalShots = [...result.counts.values()].reduce((sum, count) => sum + count, 0);
  const dominant = entries[0] ?? null;

  return (
    <div className="results-panel">
      <div className="results-panel__overview">
        <article className="metric-card">
          <span className="metric-card__label">Dominant state</span>
          <strong className="metric-card__value">
            {dominant ? `|${dominant[0]}⟩` : 'Unavailable'}
          </strong>
          <span className="metric-card__detail">
            {dominant ? `${(dominant[1] * 100).toFixed(1)}% probability` : 'No peak detected'}
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Unique outcomes</span>
          <strong className="metric-card__value">{result.counts.size}</strong>
          <span className="metric-card__detail">Measured across the current sample set</span>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Shot count</span>
          <strong className="metric-card__value">{totalShots}</strong>
          <span className="metric-card__detail">Worker simulation depth</span>
        </article>
      </div>

      <div className="distribution-table" role="table">
        <div className="distribution-table__header" role="row">
          <span>Rank</span>
          <span>State</span>
          <span>Probability</span>
          <span>Count</span>
        </div>
        <div className="distribution-table__body">
          {entries.map(([bitstring, probability], index) => (
            <div className="distribution-row" key={bitstring} role="row">
              <span className="distribution-row__rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="distribution-row__state">{formatLabel(bitstring)}</span>
              <div
                aria-label={`${formatLabel(bitstring)} ${(probability * 100).toFixed(2)} percent`}
                className="distribution-row__meter"
              >
                <span
                  className="distribution-row__fill"
                  style={{ width: `${Math.max((probability / max) * 100, 4)}%` }}
                />
                <span className="distribution-row__probability">{(probability * 100).toFixed(2)}%</span>
              </div>
              <span className="distribution-row__count">{result.counts.get(bitstring) ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="results-panel__note">
        States are sorted by measured probability. Bars are normalized to the strongest observed
        outcome to keep low-amplitude states legible.
      </p>
    </div>
  );
}

function formatLabel(bitstring: string): string {
  if (bitstring.length <= 10) {
    return `|${bitstring}⟩`;
  }
  return `|${bitstring.slice(0, 4)}…${bitstring.slice(-4)}⟩`;
}
