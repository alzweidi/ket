export interface Complex {
  re: number;
  im: number;
}

export const C = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = C(0, 0);
export const ONE: Complex = C(1, 0);
export const I: Complex = C(0, 1);

export function cadd(a: Complex, b: Complex): Complex {
  return C(a.re + b.re, a.im + b.im);
}

export function csub(a: Complex, b: Complex): Complex {
  return C(a.re - b.re, a.im - b.im);
}

export function cmul(a: Complex, b: Complex): Complex {
  return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

export function cdiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / denom, (a.im * b.re - a.re * b.im) / denom);
}

export function cconj(a: Complex): Complex {
  return C(a.re, -a.im);
}

export function cabs2(a: Complex): number {
  return a.re * a.re + a.im * a.im;
}

export function cabs(a: Complex): number {
  return Math.sqrt(cabs2(a));
}

export function cneg(a: Complex): Complex {
  return C(-a.re, -a.im);
}

export function cexp(theta: number): Complex {
  return C(Math.cos(theta), Math.sin(theta));
}

export function creal(x: number): Complex {
  return C(x, 0);
}

export function ceq(a: Complex, b: Complex): boolean {
  return Math.abs(a.re - b.re) <= 1e-10 && Math.abs(a.im - b.im) <= 1e-10;
}
