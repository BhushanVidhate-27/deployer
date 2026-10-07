const http = require('node:http');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readdirSync, statSync, rmSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'deployments');
const deployments = new Map();
mkdirSync(ROOT, { recursive: true });

function log(deployment, line) {
  deployment.logs.push(`[${new Date().toISOString()}] ${line}`);
  if (deployment.logs.length > 800) deployment.logs.shift();
}

function run(deployment, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    log(deployment, `$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: options.cwd, env: process.env, shell: false });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; chunk.toString().split(/\r?\n/).filter(Boolean).forEach(x => log(deployment, x)); });
    child.stderr.on('data', chunk => { output += chunk; chunk.toString().split(/\r?\n/).filter(Boolean).forEach(x => log(deployment, x)); });
    child.on('error', error => reject(error));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function repoUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid http(s) Git repository URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) repository URLs are allowed.');
  if (url.username || url.password) throw new Error('Repository URLs must not contain credentials.');
  return url.toString();
}

function findCompose(dir) {
  const priority = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
  return priority.find(file => existsSync(path.join(dir, file)));
}

function publicPorts(portMap) {
  const found = [];
  for (const bindings of Object.values(portMap || {})) for (const binding of bindings || []) {
    if (binding.HostPort) found.push({ hostPort: binding.HostPort, url: `http://localhost:${binding.HostPort}` });
  }
  return found;
}

async function detectComposePorts(deployment) {
  const ids = (await run(deployment, 'docker', ['compose', '-f', deployment.composeFile, 'ps', '-q'], { cwd: deployment.dir })).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const raw = await run(deployment, 'docker', ['inspect', id], { cwd: deployment.dir });
    const info = JSON.parse(raw)[0];
    deployment.services.push({ name: info.Name.replace(/^\//, ''), ports: publicPorts(info.NetworkSettings.Ports) });
  }
}

async function deploy(deployment) {
  try {
    deployment.status = 'cloning';
    log(deployment, 'Cloning repository…');
    await run(deployment, 'git', ['clone', '--depth', '1', deployment.repository, deployment.dir]);
    const compose = findCompose(deployment.dir);
    if (compose) {
      deployment.kind = 'compose'; deployment.composeFile = compose; deployment.status = 'building';
      log(deployment, `Found ${compose}; starting Docker Compose deployment.`);
      await run(deployment, 'docker', ['compose', '-f', compose, 'up', '--build', '-d', '--remove-orphans'], { cwd: deployment.dir });
      deployment.status = 'discovering'; await detectComposePorts(deployment);
    } else if (existsSync(path.join(deployment.dir, 'Dockerfile'))) {
      deployment.kind = 'dockerfile'; deployment.status = 'building';
      const tag = `local-deployer-${deployment.id}`;
      await run(deployment, 'docker', ['build', '-t', tag, '.'], { cwd: deployment.dir });
      const container = (await run(deployment, 'docker', ['run', '-d', '-P', '--name', tag, tag], { cwd: deployment.dir })).trim();
      deployment.container = container; deployment.status = 'discovering';
      const raw = await run(deployment, 'docker', ['inspect', container]);
      const info = JSON.parse(raw)[0]; deployment.services.push({ name: info.Name.replace(/^\//, ''), ports: publicPorts(info.NetworkSettings.Ports) });
    } else {
      throw new Error('No Compose file or Dockerfile found. Runtime detection is intentionally not enabled yet.');
    }
    deployment.status = 'running'; log(deployment, 'Deployment is running. Local endpoints were discovered from Docker port bindings.');
  } catch (error) {
    deployment.status = 'failed'; deployment.error = error.message; log(deployment, `FAILED: ${error.message}`);
  }
}

function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
function snapshot(deployment) { const { dir, ...safe } = deployment; return safe; }

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(await readFile(path.join(__dirname, 'public', 'index.html')));
  }
  if (request.method === 'GET' && url.pathname === '/app.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); return response.end(await readFile(path.join(__dirname, 'public', 'app.js'))); }
  if (request.method === 'GET' && url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(await readFile(path.join(__dirname, 'public', 'style.css'))); }
  if (request.method === 'GET' && url.pathname === '/api/deployments') return json(response, 200, [...deployments.values()].map(snapshot));
  if (request.method === 'POST' && url.pathname === '/api/deployments') {
    let body = ''; for await (const chunk of request) body += chunk;
    try {
      const repository = repoUrl(JSON.parse(body).repository || '');
      const id = crypto.randomUUID().slice(0, 8), dir = path.join(ROOT, id);
      const deployment = { id, repository, dir, status: 'queued', kind: null, services: [], logs: [], createdAt: new Date().toISOString(), error: null };
      deployments.set(id, deployment); deploy(deployment); return json(response, 202, snapshot(deployment));
    } catch (error) { return json(response, 400, { error: error.message }); }
  }
  response.writeHead(404); response.end('Not found');
});

if (require.main === module) {
  // Bind locally by default: this dashboard is intentionally not an Internet-facing service.
  server.listen(PORT, '127.0.0.1', () => console.log(`Local Deployer listening on http://localhost:${PORT}`));
}

module.exports = { repoUrl, findCompose, publicPorts, server };
