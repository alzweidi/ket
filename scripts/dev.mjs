import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(name, args) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
      return;
    }

    if (signal) {
      console.error(`[${name}] exited with signal ${signal}`);
      shutdown(1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting Ket development workspace...');
console.log('Playground: Vite dev server on localhost (default 5173, auto-falls back if busy)');
console.log('CLI bundle: dist/ket.js (watch mode)\n');

run('playground', ['--filter', 'ket-playground', 'dev']);
run('cli-build', ['build:watch']);
