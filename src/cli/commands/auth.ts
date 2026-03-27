import { writeConfig } from '../config.js';

export function authCommand(args: string[]): void {
  const token = readFlag(args, '--ibm');
  if (!token) {
    throw new Error('Usage: ket auth --ibm <token> [--instance <hub/group/project>] [--backend <name>]');
  }
  writeConfig({
    ibm: {
      token,
      instance: readFlag(args, '--instance') ?? 'ibm-q/open/main',
      backend: readFlag(args, '--backend') ?? 'ibm_brisbane'
    }
  });
  process.stdout.write('IBM Quantum credentials saved.\n');
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1] ?? null;
}
