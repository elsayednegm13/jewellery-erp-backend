const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const evidence = path.join(__dirname, '../reports', `customer-invoice-snapshot-ephemeral-frontend-clean-runtime-${new Date().toISOString().replace(/[-:.]/g, '')}`);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'darfus-invoice-frontend-clean-'));
const tempApp = path.join(tempRoot, 'frontend');
let frontend;

function write(name, value) { fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
async function waitHttp(url, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status > 0) return r.status; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`STARTUP_TIMEOUT:${url}`);
}
function cleanup() {
  try { if (frontend && !frontend.killed) frontend.kill(); } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  fs.cpSync(repo, tempApp, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      if (['.git', '.next', 'node_modules', 'backend', 'reports', 'test'].includes(base)) return false;
      if (base.startsWith('.env')) return false;
      return true;
    },
  });
  const installEnv = { ...process.env, NODE_ENV: 'development' };
  const env = { ...installEnv, NODE_ENV: 'production', NEXT_PUBLIC_DATA_SOURCE: 'api', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:39991/api/v1', NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:39991', BACKEND_ORIGIN: 'http://127.0.0.1:39991' };
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const install = spawnSync(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: tempApp, env: installEnv, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  write('npm-ci.stdout.log', install.stdout || '');
  write('npm-ci.stderr.log', install.stderr || '');
  write('npm-ci.json', { command: `${process.execPath} ${npmCli} ci --no-audit --no-fund`, cwd: tempApp, installNodeEnv: installEnv.NODE_ENV, exitCode: install.status, error: install.error ? String(install.error.message) : null });
  if (install.status !== 0) throw new Error(`NPM_CI_FAILED:${install.status}`);
  write('prebuild-files.json', {
    sourceFiles: ['components/ui/button.tsx', 'components/ui/card.tsx', 'components/ui/page-header.tsx', 'hooks/use-permissions.ts', 'lib/api/client.ts'].map((relative) => ({ relative, exists: fs.existsSync(path.join(tempApp, relative)) })),
    tsconfig: fs.readFileSync(path.join(tempApp, 'tsconfig.json'), 'utf8'),
    packageJson: fs.readFileSync(path.join(tempApp, 'package.json'), 'utf8'),
  });
  const build = spawnSync(process.execPath, [npmCli, 'run', 'build', '--', '--webpack'], { cwd: tempApp, env, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  write('build.stdout.log', build.stdout || '');
  write('build.stderr.log', build.stderr || '');
  write('build.json', { command: `${process.execPath} ${npmCli} run build -- --webpack`, cwd: tempApp, exitCode: build.status, error: build.error ? String(build.error.message) : null });
  if (build.status !== 0) throw new Error(`FRONTEND_BUILD_FAILED:${build.status}`);
  const port = await freePort();
  const detached = process.argv.includes('--detach');
  frontend = spawn(process.execPath, [path.join(tempApp, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: tempApp, env, detached, stdio: detached ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  if (frontend.stdout) frontend.stdout.on('data', (b) => { stdout += String(b); });
  if (frontend.stderr) frontend.stderr.on('data', (b) => { stderr += String(b); });
  const status = await waitHttp(`http://127.0.0.1:${port}/ar/login`);
  write('startup.json', { port, status, pid: frontend.pid, cwd: tempApp, apiTarget: env.NEXT_PUBLIC_API_ORIGIN });
  write('startup.stdout.log', stdout);
  write('startup.stderr.log', stderr);
  write('runtime.json', { evidence, tempApp, tempRoot, port, pid: frontend.pid, startedAt: new Date().toISOString(), node: process.version, npm: spawnSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' }).stdout.trim() });
  console.log(JSON.stringify({ result: 'READY', evidence, tempApp, tempRoot, port, pid: frontend.pid }, null, 2));
  if (detached) { frontend.unref(); return; }
  await new Promise(() => {});
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
main().catch((error) => { write('runtime-failure.json', { result: 'BLOCKED', message: error.message, stack: error.stack?.split('\n').slice(0, 10), tempRoot, tempApp }); console.error(error.message); if (!process.argv.includes('--keep-on-failure')) cleanup(); process.exitCode = 1; });
