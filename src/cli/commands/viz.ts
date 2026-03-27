import { exec } from 'node:child_process';

import { readSourceFile } from '../../shared/files.js';

export function vizCommand(args: string[]): void {
  const file = args[0];
  if (!file) {
    throw new Error('Usage: ket viz <file.ket>');
  }
  const source = readSourceFile(file);
  const encoded = Buffer.from(source, 'utf8').toString('base64url');
  const url = `https://ket-playground.vercel.app/?program=${encoded}`;
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  exec(`${opener} "${url}"`);
  process.stdout.write('Opening circuit in browser...\n');
}
