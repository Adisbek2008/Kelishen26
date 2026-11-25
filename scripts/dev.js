// Запускает API (порт 3000) и Vite dev-server (5173) одновременно
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const api = run('node', ['--disable-warning=ExperimentalWarning', '--watch', 'server/index.js']);
const web = run('npx', ['vite']);
const stop = () => { api.kill(); web.kill(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
