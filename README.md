# Local Deployer

A deliberately small local deployment app: submit a public Git repository URL, and it clones the repository, prefers Docker Compose files, falls back to a Dockerfile, starts it with Docker, discovers published ports, and streams command output in the browser.

## Requirements

- Node.js 20 or newer
- Git
- Docker Desktop or Docker Engine with the Compose v2 plugin running

## Run

```sh
npm start
```

Open `http://localhost:3000`, paste a public repository URL, and choose **Deploy**.

## Deployment behavior

1. Shallow-clones the requested repository into `deployments/<id>`.
2. Uses the first matching file in this order: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`.
3. Runs `docker compose up --build -d --remove-orphans`, or, when no Compose file exists, builds the `Dockerfile` and runs it with Docker-assigned host ports (`-P`).
4. Inspects containers and displays actual localhost URLs for published ports. It does **not** claim to provide a public URL, DNS, TLS, or a proxy.

## Important safety boundary

This is a local development tool, not a multi-tenant hosting platform. A repository's Dockerfile or Compose file can execute arbitrary build/runtime code, request mounted resources, or publish ports. Only deploy repositories you trust. Do not expose the dashboard to the internet. For Internet-facing use, add sandboxing, authentication, an allowlist/registry, a reverse proxy, resource limits, secrets management, and Compose/Dockerfile policy checks first.

MoneyPrinterTurbo is supported in principle because it has Compose configuration, but it can require model/API credentials and can have a large build/download footprint. Supply its configuration first and test it on a machine with sufficient resources.

## Current scope

- Public HTTP(S) Git URLs only; credential-bearing URLs are rejected.
- No runtime auto-detection yet; repositories without Compose or a Dockerfile fail clearly.
- Deployment records live in memory and clones remain in `deployments/` for inspection.
- This project uses Node's built-in HTTP server and has no runtime npm dependencies.
