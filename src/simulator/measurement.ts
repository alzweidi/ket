import { RuntimeError } from '../shared/errors.js';
import { C, ZERO, cabs2 } from './complex.js';
import { StateVector } from './statevector.js';

export interface MeasurementResult {
  bitstring: string;
  collapsedState: StateVector;
}

export function measureAll(sv: StateVector): MeasurementResult {
  const probabilities = sv.probabilities();
  const index = sampleIndex(probabilities);
  const bitstring = index.toString(2).padStart(sv.getN(), '0');
  return {
    bitstring,
    collapsedState: collapseToIndex(sv, index)
  };
}

export function measureQubit(
  sv: StateVector,
  qubitIndex: number
): { bit: 0 | 1; collapsed: StateVector } {
  const n = sv.getN();
  const mask = 1 << (n - 1 - qubitIndex);
  const amplitudes = sv.getAmplitudes();
  let p1 = 0;
  amplitudes.forEach((amp, index) => {
    if ((index & mask) !== 0) {
      p1 += cabs2(amp);
    }
  });

  const bit: 0 | 1 = Math.random() < p1 ? 1 : 0;
  const remaining = amplitudes.map((amp, index) => (((index & mask) !== 0) === (bit === 1) ? C(amp.re, amp.im) : ZERO));
  const collapsed = StateVector.fromAmplitudes(n, remaining);
  collapsed.normalize();
  return { bit, collapsed };
}

export function measureRegister(sv: StateVector, qubits: number[]): MeasurementResult {
  if (qubits.length === sv.getN()) {
    return measureAll(sv);
  }

  const amplitudes = sv.getAmplitudes();
  const probs = new Map<string, number>();

  amplitudes.forEach((amp, index) => {
    const key = qubits.map((qubit) => (((index >> (sv.getN() - 1 - qubit)) & 1) === 1 ? '1' : '0')).join('');
    probs.set(key, (probs.get(key) ?? 0) + cabs2(amp));
  });

  const outcomes = [...probs.entries()];
  const sampled = sampleIndex(outcomes.map(([, probability]) => probability));
  const measuredBits = outcomes[sampled]?.[0];
  if (!measuredBits) {
    throw new RuntimeError('Failed to sample register measurement', 1, 1, 'runtime');
  }

  const next = amplitudes.map((amp, index) => {
    const key = qubits.map((qubit) => (((index >> (sv.getN() - 1 - qubit)) & 1) === 1 ? '1' : '0')).join('');
    return key === measuredBits ? C(amp.re, amp.im) : ZERO;
  });

  const collapsedState = StateVector.fromAmplitudes(sv.getN(), next);
  collapsedState.normalize();
  return { bitstring: measuredBits, collapsedState };
}

function sampleIndex(probabilities: number[]): number {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  const target = Math.random() * total;
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index]!;
    if (target <= cumulative) {
      return index;
    }
  }
  return probabilities.length - 1;
}

function collapseToIndex(sv: StateVector, targetIndex: number): StateVector {
  const amplitudes = Array.from({ length: 1 << sv.getN() }, (_, index) => (index === targetIndex ? C(1, 0) : ZERO));
  return StateVector.fromAmplitudes(sv.getN(), amplitudes);
}
