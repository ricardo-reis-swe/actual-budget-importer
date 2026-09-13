import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/start-server.ts'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], {
    stdio: 'inherit',
  }),
];

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

for (const child of children) {
  child.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
    stop();
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    process.exitCode = code ?? (signal ? 1 : 0);
    stop();
  });
}
