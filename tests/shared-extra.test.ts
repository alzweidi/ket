import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileSource, parseSource } from '../src/shared/compiler.js';
import {
  IBMError,
  KetError,
  LexError,
  ParseError,
  RuntimeError,
  SimulatorError,
  TypeError as KetTypeError,
} from '../src/shared/errors.js';
import { readSourceFile } from '../src/shared/files.js';

describe('shared compiler helpers', () => {
  it('parses source without type-checking', () => {
    const program = parseSource('qubit q\n', 'parse-only.ket');
    expect(program.kind).toBe('program');
    expect(program.body[0]).toMatchObject({ kind: 'qubit_decl', name: 'q' });
  });

  it('compiles valid source', () => {
    const program = compileSource(
      'qubit q\nH q\nlet r = measure q\n',
      'compile.ket'
    );
    expect(program.body).toHaveLength(3);
  });
});

describe('shared file helpers', () => {
  it('reads source files as utf-8 text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-read-'));
    const file = path.join(dir, 'program.ket');
    fs.writeFileSync(file, 'qubit q\n', 'utf8');

    expect(readSourceFile(file)).toBe('qubit q\n');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('error classes', () => {
  it('formats ket-derived errors with location metadata', () => {
    const error = new KetError('bad thing', 2, 4, 'demo.ket');
    expect(error.message).toBe('demo.ket:2:4: bad thing');
    expect(error.name).toBe('KetError');
    expect(error.line).toBe(2);
    expect(error.column).toBe(4);
    expect(error.filename).toBe('demo.ket');
  });

  it('sets specialised error names and messages', () => {
    expect(new LexError('nope', 1, 1, 'a.ket')).toMatchObject({
      name: 'LexError',
      message: 'a.ket:1:1: LexError: nope',
    });
    expect(new ParseError('nope', 1, 1, 'a.ket')).toMatchObject({
      name: 'ParseError',
      message: 'a.ket:1:1: ParseError: nope',
    });
    expect(new KetTypeError('nope', 1, 1, 'a.ket')).toMatchObject({
      name: 'TypeError',
      message: 'a.ket:1:1: TypeError: nope',
    });
    expect(new RuntimeError('nope', 1, 1, 'a.ket')).toMatchObject({
      name: 'RuntimeError',
      message: 'a.ket:1:1: RuntimeError: nope',
    });
    expect(new SimulatorError('sim failed')).toMatchObject({
      name: 'SimulatorError',
      message: 'sim failed',
    });
    expect(new IBMError('auth failed', 401, 'AUTH')).toMatchObject({
      name: 'IBMError',
      message: 'auth failed',
      statusCode: 401,
      ibmCode: 'AUTH',
    });
  });
});
