import { describe, expect, it } from 'vitest';

import { resolveBackend } from '../src/cli/commands/run.js';
import { compileSource } from '../src/shared/compiler.js';

describe('run command backend resolution', () => {
  it('uses the source run statement backend when no cli override is provided', () => {
    const program = compileSource(
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell() on ibm\n',
      'bell.ket'
    );

    expect(resolveBackend(program, null)).toBe('ibm');
  });

  it('lets the cli override the source backend', () => {
    const program = compileSource(
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell() on ibm\n',
      'bell.ket'
    );

    expect(resolveBackend(program, 'local')).toBe('local');
  });

  it('rejects unsupported backend names', () => {
    const program = compileSource(
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell()\n',
      'bell.ket'
    );

    expect(() => resolveBackend(program, 'remote')).toThrow(
      "Unsupported backend 'remote'"
    );
  });
});
