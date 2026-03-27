import { SimulatorError } from '../shared/errors.js';
import { C, ONE, ZERO, cabs2, cadd, cdiv, cmul, creal, type Complex } from './complex.js';
import type { Matrix2x2, Matrix4x4, Matrix8x8 } from './gates.js';

export class StateVector {
  private amps: Complex[];

  public constructor(private readonly n: number) {
    if (n < 1 || n > 20) {
      throw new SimulatorError(`n must be 1-20, got ${n}`);
    }
    this.amps = Array.from({ length: 1 << n }, () => ZERO);
    this.amps[0] = ONE;
  }

  public static fromAmplitudes(n: number, amplitudes: Complex[]): StateVector {
    const state = new StateVector(n);
    state.amps = amplitudes.map((amp) => C(amp.re, amp.im));
    return state;
  }

  public getAmplitudes(): readonly Complex[] {
    return this.amps;
  }

  public getN(): number {
    return this.n;
  }

  public clone(): StateVector {
    return StateVector.fromAmplitudes(this.n, this.amps);
  }

  public replaceWith(other: StateVector): void {
    if (other.getN() !== this.n) {
      throw new SimulatorError('Cannot replace statevector with different qubit count');
    }
    this.amps = [...other.getAmplitudes()].map((amp) => C(amp.re, amp.im));
  }

  public applySingle(U: Matrix2x2, target: number): void {
    this.assertQubit(target);
    const mask = 1 << (this.n - 1 - target);
    for (let i = 0; i < this.amps.length; i += 1) {
      if ((i & mask) !== 0) {
        continue;
      }
      const j = i | mask;
      const a = this.amps[i]!;
      const b = this.amps[j]!;
      this.amps[i] = cadd(cmul(U[0][0], a), cmul(U[0][1], b));
      this.amps[j] = cadd(cmul(U[1][0], a), cmul(U[1][1], b));
    }
  }

  public applyControlledSingle(U: Matrix2x2, control: number, target: number): void {
    this.assertQubit(control);
    this.assertQubit(target);
    if (control === target) {
      throw new SimulatorError('Control and target qubits must be distinct');
    }

    const controlMask = 1 << (this.n - 1 - control);
    const targetMask = 1 << (this.n - 1 - target);

    for (let i = 0; i < this.amps.length; i += 1) {
      if ((i & controlMask) === 0 || (i & targetMask) !== 0) {
        continue;
      }
      const j = i | targetMask;
      const a = this.amps[i]!;
      const b = this.amps[j]!;
      this.amps[i] = cadd(cmul(U[0][0], a), cmul(U[0][1], b));
      this.amps[j] = cadd(cmul(U[1][0], a), cmul(U[1][1], b));
    }
  }

  public applyTwo(U: Matrix4x4, q0: number, q1: number): void {
    this.assertDistinct([q0, q1]);
    const mask0 = 1 << (this.n - 1 - q0);
    const mask1 = 1 << (this.n - 1 - q1);

    for (let i = 0; i < this.amps.length; i += 1) {
      if ((i & mask0) !== 0 || (i & mask1) !== 0) {
        continue;
      }
      const i00 = i;
      const i01 = i | mask1;
      const i10 = i | mask0;
      const i11 = i | mask0 | mask1;
      const v: [Complex, Complex, Complex, Complex] = [
        this.amps[i00]!,
        this.amps[i01]!,
        this.amps[i10]!,
        this.amps[i11]!
      ];
      const w = multiplyMatrix4(U, v);
      this.amps[i00] = w[0];
      this.amps[i01] = w[1];
      this.amps[i10] = w[2];
      this.amps[i11] = w[3];
    }
  }

  public applyThree(U: Matrix8x8, q0: number, q1: number, q2: number): void {
    this.assertDistinct([q0, q1, q2]);
    const masks = [q0, q1, q2].map((q) => 1 << (this.n - 1 - q));

    for (let i = 0; i < this.amps.length; i += 1) {
      if ((i & masks[0]!) !== 0 || (i & masks[1]!) !== 0 || (i & masks[2]!) !== 0) {
        continue;
      }
      const indices = [
        i,
        i | masks[2]!,
        i | masks[1]!,
        i | masks[1]! | masks[2]!,
        i | masks[0]!,
        i | masks[0]! | masks[2]!,
        i | masks[0]! | masks[1]!,
        i | masks[0]! | masks[1]! | masks[2]!
      ];
      const vector = indices.map((index) => this.amps[index]!) as [
        Complex,
        Complex,
        Complex,
        Complex,
        Complex,
        Complex,
        Complex,
        Complex
      ];
      const result = multiplyMatrix8(U, vector);
      result.forEach((amp, idx) => {
        this.amps[indices[idx]!] = amp;
      });
    }
  }

  public applyMultiControlledX(controls: number[], target: number): void {
    this.assertDistinct([...controls, target]);
    const controlMask = controls.reduce((mask, qubit) => mask | (1 << (this.n - 1 - qubit)), 0);
    const targetMask = 1 << (this.n - 1 - target);

    for (let i = 0; i < this.amps.length; i += 1) {
      if ((i & controlMask) === controlMask) {
        const j = i ^ targetMask;
        if (i < j) {
          const temp = this.amps[i]!;
          this.amps[i] = this.amps[j]!;
          this.amps[j] = temp;
        }
      }
    }
  }

  public probabilities(): number[] {
    return this.amps.map((amp) => cabs2(amp));
  }

  public normalize(): void {
    const norm = Math.sqrt(this.probabilities().reduce((sum, value) => sum + value, 0));
    if (norm === 0) {
      throw new SimulatorError('Cannot normalize zero state');
    }
    this.amps = this.amps.map((amp) => cdiv(amp, creal(norm)));
  }

  private assertQubit(qubit: number): void {
    if (qubit < 0 || qubit >= this.n) {
      throw new SimulatorError(`Qubit index ${qubit} out of bounds for ${this.n} qubits`);
    }
  }

  private assertDistinct(qubits: number[]): void {
    qubits.forEach((qubit) => this.assertQubit(qubit));
    if (new Set(qubits).size !== qubits.length) {
      throw new SimulatorError('Gate operands must be distinct');
    }
  }
}

function multiplyMatrix4(
  matrix: Matrix4x4,
  vector: [Complex, Complex, Complex, Complex]
): [Complex, Complex, Complex, Complex] {
  return matrix.map((row) =>
    row.reduce((sum, entry, index) => cadd(sum, cmul(entry, vector[index]!)), ZERO)
  ) as [Complex, Complex, Complex, Complex];
}

function multiplyMatrix8(
  matrix: Matrix8x8,
  vector: [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex]
): [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex] {
  return matrix.map((row) =>
    row.reduce((sum, entry, index) => cadd(sum, cmul(entry, vector[index]!)), ZERO)
  ) as [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex];
}
