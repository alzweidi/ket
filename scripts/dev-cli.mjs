import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const normalizedArgs = args[0] === '--' ? args.slice(1) : args;

const build = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const run = spawnSync(process.execPath, ['dist/ket.js', ...normalizedArgs], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

process.exit(run.status ?? 0);
