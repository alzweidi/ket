import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

describe('cli command modules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('stores IBM credentials through authCommand', async () => {
    const writeConfig = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.doMock('../src/cli/config.js', () => ({ writeConfig }));

    const { authCommand } = await import('../src/cli/commands/auth.js');
    authCommand([
      '--ibm',
      'token',
      '--instance',
      'ibm-q/open/main',
      '--backend',
      'ibm_osaka',
    ]);

    expect(writeConfig).toHaveBeenCalledWith({
      ibm: {
        token: 'token',
        instance: 'ibm-q/open/main',
        backend: 'ibm_osaka',
      },
    });
    expect(stdout).toHaveBeenCalledWith('IBM Quantum credentials saved.\n');
  });

  it('rejects authCommand without a token', async () => {
    const { authCommand } = await import('../src/cli/commands/auth.js');
    expect(() => authCommand([])).toThrow('Usage: ket auth --ibm <token>');
  });

  it('treats sparse auth flags as missing values', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { authCommand } = await import('../src/cli/commands/auth.js');
    const args = ['--ibm', 'token'] as string[];
    args[1] = undefined as any;

    expect(() => authCommand(args as any)).toThrow('Usage: ket auth --ibm <token>');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('uses default IBM auth settings when optional flags are omitted', async () => {
    const writeConfig = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.doMock('../src/cli/config.js', () => ({ writeConfig }));

    const { authCommand } = await import('../src/cli/commands/auth.js');
    authCommand(['--ibm', 'token']);

    expect(writeConfig).toHaveBeenCalledWith({
      ibm: {
        token: 'token',
        instance: 'ibm-q/open/main',
        backend: 'ibm_brisbane'
      }
    });
    expect(stdout).toHaveBeenCalledWith('IBM Quantum credentials saved.\n');
  });

  it('compiles a source file to qasm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-compile-'));
    const file = path.join(dir, 'bell.ket');
    fs.writeFileSync(
      file,
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell()\n',
      'utf8'
    );

    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { compileCommand } = await import('../src/cli/commands/compile.js');
    compileCommand([file]);

    expect(stdout).toHaveBeenCalled();
    expect(String(stdout.mock.calls[0]?.[0])).toContain('OPENQASM 2.0;');
    expect(() => compileCommand([])).toThrow('Usage: ket compile <file.ket>');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs a program locally and renders a histogram', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-run-'));
    const file = path.join(dir, 'bell.ket');
    fs.writeFileSync(
      file,
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell()\n',
      'utf8'
    );

    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { runCommand } = await import('../src/cli/commands/run.js');
    await runCommand([file, '--shots', '4']);

    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(
      'Results (4 shots):'
    );
    await expect(runCommand([])).rejects.toThrow('Usage: ket run <file.ket>');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('covers backend resolution and empty local results rendering', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-run-empty-'));
    const file = path.join(dir, 'bell.ket');
    fs.writeFileSync(file, 'qubit q\n', 'utf8');

    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const runLocally = vi
      .fn()
      .mockReturnValueOnce({
        counts: new Map([['1', 1]]),
        probabilities: new Map([['1', 1]])
      })
      .mockReturnValueOnce({
        counts: new Map(),
        probabilities: new Map([['1', 1]])
      })
      .mockReturnValueOnce({
        counts: new Map(),
        probabilities: new Map()
      });

    vi.doMock('../src/backends/local.js', () => ({ runLocally }));

    const { resolveBackend, runCommand } = await import('../src/cli/commands/run.js');

    expect(resolveBackend({ kind: 'program', body: [] } as any, null)).toBe('local');
    expect(
      resolveBackend(
        { kind: 'program', body: [{ kind: 'run', backend: 'ibm' }] } as any,
        null
      )
    ).toBe('ibm');
    expect(resolveBackend({ kind: 'program', body: [] } as any, 'local')).toBe('local');
    expect(() => resolveBackend({ kind: 'program', body: [] } as any, 'bad')).toThrow(
      "Unsupported backend 'bad'"
    );

    const args = [file, '--backend', 'local'] as string[];
    await runCommand(args);

    args[2] = undefined as any;
    await runCommand(args as any);
    await runCommand([file, '--backend', 'local']);

    expect(runLocally).toHaveBeenCalled();
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('Results (1024 shots):');
    expect(String(stdout.mock.calls[0]?.[0])).toContain('(1)');
    expect(String(stdout.mock.calls[1]?.[0])).toContain('(0)');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the IBM backend when requested', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-run-ibm-'));
    const file = path.join(dir, 'bell.ket');
    fs.writeFileSync(
      file,
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell() on ibm\n',
      'utf8'
    );

    const backendRun = vi.fn().mockResolvedValue({
      counts: new Map([['1', 2]]),
      probabilities: new Map([['1', 1]]),
    });
    const IBMBackend = vi.fn().mockImplementation(() => ({ run: backendRun }));
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    vi.doMock('../src/backends/ibm.js', () => ({ IBMBackend }));
    vi.doMock('../src/cli/config.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/cli/config.js')
      >('../src/cli/config.js');
      return {
        ...actual,
        readConfig: () => ({
          ibm: {
            token: 'token',
            instance: 'ibm-q/open/main',
            backend: 'ibm_brisbane',
          },
        }),
      };
    });

    const { runCommand } = await import('../src/cli/commands/run.js');
    await runCommand([file]);

    expect(IBMBackend).toHaveBeenCalled();
    expect(backendRun).toHaveBeenCalled();
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('|1⟩');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails IBM runs when no credentials are configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-run-missing-'));
    const file = path.join(dir, 'bell.ket');
    fs.writeFileSync(
      file,
      'circuit bell() {\nqubit q\nlet r = measure q\n}\nrun bell() on ibm\n',
      'utf8'
    );

    vi.doMock('../src/cli/config.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/cli/config.js')
      >('../src/cli/config.js');
      return {
        ...actual,
        readConfig: () => ({}),
      };
    });

    const { runCommand } = await import('../src/cli/commands/run.js');
    await expect(runCommand([file])).rejects.toThrow(
      'IBM Quantum token not configured'
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens the hosted playground on each supported platform', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ket-viz-'));
    const file = path.join(dir, 'program.ket');
    fs.writeFileSync(file, 'qubit q\n', 'utf8');

    const exec = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.doMock('node:child_process', () => ({ exec }));

    const { vizCommand } = await import('../src/cli/commands/viz.js');

    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vizCommand([file]);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vizCommand([file]);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vizCommand([file]);

    expect(exec.mock.calls[0]?.[0]).toContain('open ');
    expect(exec.mock.calls[1]?.[0]).toContain('start ');
    expect(exec.mock.calls[2]?.[0]).toContain('xdg-open ');
    expect(stdout).toHaveBeenCalledWith('Opening circuit in browser...\n');
    expect(() => vizCommand([])).toThrow('Usage: ket viz <file.ket>');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
