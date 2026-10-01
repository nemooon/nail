import { spawn } from 'node:child_process'

const processes = [
  spawn(process.execPath, ['src/local/index.ts'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:ui'], { stdio: 'inherit' }),
]

function stop() {
  for (const child of processes) child.kill('SIGTERM')
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of processes) child.on('exit', code => {
  if (code && process.exitCode === undefined) process.exitCode = code
  stop()
})
