import { IBMBackend } from '../../backends/ibm.js';
import { runLocally } from '../../backends/local.js';
import { QasmEmitter } from '../../codegen/qasm.js';
import { readConfig } from '../config.js';
import type { Program, RunStatement } from '../../parser/ast.js';
import { compileSource } from '../../shared/compiler.js';
import { readSourceFile } from '../../shared/files.js';

export async function runCommand(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) {
    throw new Error(
      'Usage: ket run <file.ket> [--backend <local|ibm>] [--shots <n>]'
    );
  }
  const source = readSourceFile(file);
  const program = compileSource(source, file);
  const backend = resolveBackend(program, readFlag(args, '--backend'));
  const shots = Number.parseInt(readFlag(args, '--shots') ?? '1024', 10);

  const result =
    backend === 'ibm'
      ? await runOnIbm(program, shots)
      : runLocally(program, shots);

  process.stdout.write(renderResults(result, shots));
}

export function resolveBackend(
  program: Program,
  override: string | null
): 'local' | 'ibm' {
  if (override) {
    if (override === 'local' || override === 'ibm') {
      return override;
    }
    throw new Error(`Unsupported backend '${override}'. Use 'local' or 'ibm'.`);
  }

  const runStatement = program.body.find(
    (node): node is RunStatement => node.kind === 'run'
  );
  return runStatement?.backend ?? 'local';
}

async function runOnIbm(
  program: Parameters<typeof runLocally>[0],
  shots: number
) {
  const config = readConfig().ibm;
  if (!config) {
    throw new Error(
      'IBM Quantum token not configured. Run `ket auth --ibm <token>` first.'
    );
  }
  const qasm = new QasmEmitter().emit(program);
  return new IBMBackend(config).run(qasm, shots);
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function renderResults(
  result: Awaited<ReturnType<typeof runOnIbm>> | ReturnType<typeof runLocally>,
  shots: number
): string {
  const entries = [...result.probabilities.entries()].sort(
    (a, b) => b[1] - a[1]
  );
  const max = entries[0]?.[1] ?? 1;
  const lines = [`Results (${shots} shots):`];
  for (const [bitstring, probability] of entries) {
    const count = result.counts.get(bitstring) ?? 0;
    const width = Math.round((probability / max) * 20);
    lines.push(
      `|${bitstring}⟩  ${'█'.repeat(width).padEnd(20, ' ')}  ${probability.toFixed(3)} (${count})`
    );
  }
  return `${lines.join('\n')}\n`;
}
