import { C, I, ONE, ZERO, cexp, cneg, type Complex } from './complex.js';

export type Matrix2x2 = [[Complex, Complex], [Complex, Complex]];
export type Matrix4x4 = [
  [Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex]
];
export type Matrix8x8 = [
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex],
  [Complex, Complex, Complex, Complex, Complex, Complex, Complex, Complex]
];

function identity8x8(): Matrix8x8 {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => (row === col ? ONE : ZERO))
  ) as Matrix8x8;
}

export function gateH(): Matrix2x2 {
  const s = C(1 / Math.SQRT2);
  return [[s, s], [s, cneg(s)]];
}

export function gateX(): Matrix2x2 {
  return [[ZERO, ONE], [ONE, ZERO]];
}

export function gateY(): Matrix2x2 {
  return [[ZERO, C(0, -1)], [C(0, 1), ZERO]];
}

export function gateZ(): Matrix2x2 {
  return [[ONE, ZERO], [ZERO, C(-1)]];
}

export function gateS(): Matrix2x2 {
  return [[ONE, ZERO], [ZERO, I]];
}

export function gateT(): Matrix2x2 {
  return [[ONE, ZERO], [ZERO, cexp(Math.PI / 4)]];
}

export function gateRx(theta: number): Matrix2x2 {
  const c = C(Math.cos(theta / 2));
  const s = C(0, -Math.sin(theta / 2));
  return [[c, s], [s, c]];
}

export function gateRy(theta: number): Matrix2x2 {
  const c = C(Math.cos(theta / 2));
  const s = C(Math.sin(theta / 2));
  return [[c, cneg(s)], [s, c]];
}

export function gateRz(theta: number): Matrix2x2 {
  return [[cexp(-theta / 2), ZERO], [ZERO, cexp(theta / 2)]];
}

export function gateCNOT(): Matrix4x4 {
  return [
    [ONE, ZERO, ZERO, ZERO],
    [ZERO, ONE, ZERO, ZERO],
    [ZERO, ZERO, ZERO, ONE],
    [ZERO, ZERO, ONE, ZERO]
  ];
}

export function gateCZ(): Matrix4x4 {
  return [
    [ONE, ZERO, ZERO, ZERO],
    [ZERO, ONE, ZERO, ZERO],
    [ZERO, ZERO, ONE, ZERO],
    [ZERO, ZERO, ZERO, C(-1)]
  ];
}

export function gateSWAP(): Matrix4x4 {
  return [
    [ONE, ZERO, ZERO, ZERO],
    [ZERO, ZERO, ONE, ZERO],
    [ZERO, ONE, ZERO, ZERO],
    [ZERO, ZERO, ZERO, ONE]
  ];
}

export function gateToffoli(): Matrix8x8 {
  const matrix = identity8x8();
  matrix[6][6] = ZERO;
  matrix[6][7] = ONE;
  matrix[7][6] = ONE;
  matrix[7][7] = ZERO;
  return matrix;
}
