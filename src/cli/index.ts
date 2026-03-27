#!/usr/bin/env node
import { authCommand } from './commands/auth.js';
import { compileCommand } from './commands/compile.js';
import { runCommand } from './commands/run.js';
import { vizCommand } from './commands/viz.js';
import { IBMError, KetError } from '../shared/errors.js';

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const [command, ...args] = normalizedArgs;

  switch (command) {
    case 'run':
      await runCommand(args);
      return;
    case 'compile':
      compileCommand(args);
      return;
    case 'viz':
      vizCommand(args);
      return;
    case 'auth':
      authCommand(args);
      return;
    default:
      process.stderr.write(
        'Usage:\n' +
          '  ket run <file.ket> [--backend <local|ibm>] [--shots <n>]\n' +
          '  ket compile <file.ket>\n' +
          '  ket viz <file.ket>\n' +
          '  ket auth --ibm <token> [--instance <hub/group/project>] [--backend <name>]\n'
      );
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof KetError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof IBMError) {
    process.stderr.write(
      `IBMError: ${error.message}${error.statusCode ? ` (${error.statusCode})` : ''}\n`
    );
    process.exitCode = 1;
    return;
  }
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write('Unexpected internal error\n');
  process.exitCode = 2;
});
