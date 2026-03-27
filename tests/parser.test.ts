import { describe, expect, it } from 'vitest';

import { Lexer } from '../src/lexer/lexer.js';
import { Parser } from '../src/parser/parser.js';

function parse(source: string) {
  return new Parser(new Lexer(source, 'test.ket').tokenize(), 'test.ket').parse();
}

describe('Parser', () => {
  it('parses a qubit declaration and gate application', () => {
    const program = parse('qubit q[3]\nH q[0]\n');
    expect(program.body[0]).toMatchObject({ kind: 'qubit_decl', name: 'q', size: 3 });
    expect(program.body[1]).toMatchObject({ kind: 'gate_app', gate: 'H' });
  });

  it('parses parameterized gates and repeat expressions', () => {
    const program = parse('repeat floor(π/4 * sqrt(8)) {\nRx(π/2) q[0]\n}\n');
    expect(program.body[0]).toMatchObject({ kind: 'repeat' });
  });

  it('parses circuit definitions and run statements', () => {
    const program = parse('circuit grover(target: bitstring) {\n  qubit q[3]\n}\nrun grover(|101⟩) on ibm\n');
    expect(program.body[0]).toMatchObject({ kind: 'circuit_def', name: 'grover' });
    expect(program.body[1]).toMatchObject({ kind: 'run', backend: 'ibm' });
  });

  it('parses angle expressions in run arguments', () => {
    const program = parse('circuit rotate(theta: angle) {\n  qubit q\n}\nrun rotate(π/2)\n');
    expect(program.body[1]).toMatchObject({
      kind: 'run',
      args: [{ kind: 'angle_expr', expr: { kind: 'binop', op: '/' } }]
    });
  });

  it('throws on missing closing brace', () => {
    expect(() => parse('if r == 1 {\nH q[0]\n')).toThrow('ParseError');
  });
});
