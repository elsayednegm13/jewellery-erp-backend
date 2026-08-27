const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const evidence = path.join(__dirname, '../reports', `customer-invoice-snapshot-ephemeral-build-forensic-${new Date().toISOString().replace(/[-:.]/g, '')}`);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'darfus-invoice-build-forensic-'));
const tempApp = path.join(tempRoot, 'frontend');
fs.mkdirSync(evidence, { recursive: true });

try {
  fs.cpSync(repo, tempApp, {
    recursive: true,
    filter: (source) => !['.git', '.next', 'node_modules', 'backend', 'reports', 'test'].includes(path.basename(source)),
  });
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(tempApp, 'node_modules'), 'junction');
  const command = process.execPath;
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const env = { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_DATA_SOURCE: 'api', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:39991/api/v1', NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:39991', BACKEND_ORIGIN: 'http://127.0.0.1:39991' };
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, [npmCli, 'run', 'build', '--', '--webpack'], {
    cwd: tempApp,
    env,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const metadata = {
    command: `${command} ${npmCli} run build -- --webpack`,
    cwd: tempApp,
    sourceRoot: repo,
    nodeModulesStrategy: 'junction to repository node_modules',
    nextArtifactsStrategy: 'temporary copy excludes .next',
    env: { NODE_ENV: env.NODE_ENV, NEXT_PUBLIC_DATA_SOURCE: env.NEXT_PUBLIC_DATA_SOURCE, NEXT_PUBLIC_API_URL: env.NEXT_PUBLIC_API_URL, NEXT_PUBLIC_API_ORIGIN: env.NEXT_PUBLIC_API_ORIGIN, BACKEND_ORIGIN: env.BACKEND_ORIGIN },
    startedAt,
    finishedAt,
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message) : null,
  };
  fs.writeFileSync(path.join(evidence, 'command.json'), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(evidence, 'stdout.log'), result.stdout || '');
  fs.writeFileSync(path.join(evidence, 'stderr.log'), result.stderr || '');
  fs.writeFileSync(path.join(evidence, 'combined.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
  console.log(JSON.stringify({ evidence, ...metadata }, null, 2));
  process.exitCode = result.status === 0 ? 0 : 1;
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
