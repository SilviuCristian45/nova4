#!/usr/bin/env node
/**
 * Cross-platform helper to run the full 5-service RepLog stack (postgres, minio, api, web, caddy)
 * locally in Docker on http://localhost (no domain or TLS certificate required).
 *
 * Usage:
 *   node scripts/local-docker.mjs up [--no-build]
 *   node scripts/local-docker.mjs down [--reset]
 *   node scripts/local-docker.mjs restart
 *   node scripts/local-docker.mjs logs [service...]
 *   node scripts/local-docker.mjs ps
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT_DIR, ".env.docker.local");
const API_DEV_ENV_FILE = path.join(ROOT_DIR, "apps", "api", ".env");
const PROJECT_NAME = "replog-local";

function parseSimpleEnvFile(filePath) {
  const result = {};
  if (!existsSync(filePath)) return result;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function ensureLocalDockerEnv() {
  if (existsSync(ENV_FILE)) {
    return parseSimpleEnvFile(ENV_FILE);
  }

  // Carry over optional API integrations (USDA / Google Drive) from apps/api/.env if present.
  const devEnv = parseSimpleEnvFile(API_DEV_ENV_FILE);
  const hasGoogleOAuth = Boolean(devEnv.GOOGLE_CLIENT_ID && devEnv.GOOGLE_CLIENT_SECRET);

  const lines = [
    "# Auto-generated local full-Docker environment for RepLog (gitignored — do not commit).",
    "# Delete this file and run `npm run docker:local:reset` to regenerate secrets & fresh volumes.",
    "DOMAIN=localhost",
    "PUBLIC_SCHEME=http",
    "HTTP_PORT=80",
    "HTTPS_PORT=443",
    "ADMINER_PORT=8081",
    "MINIO_CONSOLE_PORT=9001",
    "MINIO_BROWSER=on",
    "COOKIE_SECURE=false",
    "COOKIE_DOMAIN=",
    "SWAGGER_ENABLED=true",
    "DISABLE_SIGNUP=false",
    "COACH_SELF_SERVE=true",
    `SUPER_ADMIN_EMAILS=${devEnv.SUPER_ADMIN_EMAILS ?? ""}`,
    "",
    `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    `JWT_ACCESS_SECRET=${randomBytes(48).toString("base64url")}`,
    `MINIO_ROOT_USER=replog${randomBytes(6).toString("hex")}`,
    `MINIO_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`,
    `PHOTO_ENCRYPTION_KEY=${devEnv.PHOTO_ENCRYPTION_KEY || randomBytes(32).toString("base64")}`,
    "",
    `USDA_API_KEY=${devEnv.USDA_API_KEY ?? ""}`,
    `GOOGLE_CLIENT_ID=${devEnv.GOOGLE_CLIENT_ID ?? ""}`,
    `GOOGLE_CLIENT_SECRET=${devEnv.GOOGLE_CLIENT_SECRET ?? ""}`,
    `GOOGLE_REDIRECT_URI=${hasGoogleOAuth ? "http://localhost/api/v1/drive/callback" : ""}`,
    `DRIVE_TOKEN_KEY=${devEnv.DRIVE_TOKEN_KEY || randomBytes(32).toString("base64")}`,
    `CRON_SECRET=${devEnv.CRON_SECRET || randomBytes(32).toString("hex")}`,
    "DRIVE_CRON_ENABLED=true",
    "",
  ];

  writeFileSync(ENV_FILE, lines.join("\n"), "utf8");
  console.log(`Created ${path.relative(ROOT_DIR, ENV_FILE)} with persistent local secrets.`);
  return parseSimpleEnvFile(ENV_FILE);
}

function runCompose(composeArgs) {
  const args = [
    "compose",
    "-p",
    PROJECT_NAME,
    "--profile",
    "tools",
    "--env-file",
    ENV_FILE,
    "-f",
    path.join(ROOT_DIR, "docker-compose.yml"),
    ...composeArgs,
  ];
  const result = spawnSync("docker", args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to execute docker: ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printHelp() {
  console.log(`RepLog Local Full-Docker Runner (5 containers: postgres, minio, api, web, caddy)

Usage:
  npm run docker:local                         Build & start all 5 containers on http://localhost
  node scripts/local-docker.mjs up --no-build  Start existing images without rebuilding
  npm run docker:local:down                    Stop containers (keeps Postgres & MinIO data)
  npm run docker:local:reset                   Stop containers AND wipe local Docker volumes
  npm run docker:local:logs [service...]       Follow container logs (e.g. api web)
  npm run docker:local:ps                      Show container status`);
}

function main() {
  const [command = "up", ...rest] = process.argv.slice(2);

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  const env = ensureLocalDockerEnv();
  const httpPort = env.HTTP_PORT || "80";
  const adminerPort = env.ADMINER_PORT || "8081";
  const minioConsolePort = env.MINIO_CONSOLE_PORT || "9001";
  const baseUrl = httpPort === "80" ? "http://localhost" : `http://localhost:${httpPort}`;

  switch (command) {
    case "up": {
      const noBuild = rest.includes("--no-build");
      const upArgs = ["up", "-d", "--wait"];
      if (!noBuild) upArgs.push("--build");
      console.log(`Starting full RepLog Docker stack (${PROJECT_NAME})...`);
      runCompose(upArgs);
      console.log("");
      console.log("RepLog full Docker stack is healthy and ready:");
      console.log(`  Web App:      ${baseUrl}`);
      console.log(`  Swagger UI:   ${baseUrl}/api/docs`);
      console.log(`  API Health:   ${baseUrl}/api/v1/health`);
      console.log(`  Adminer (DB): http://localhost:${adminerPort}  (PostgreSQL / server: postgres / user: postgres / db: replog)`);
      console.log(`  DB password:  ${env.POSTGRES_PASSWORD ?? "(see .env.docker.local)"}`);
      console.log(`  S3 Console:   http://localhost:${minioConsolePort}  (user: ${env.MINIO_ROOT_USER ?? ""} / pass: ${env.MINIO_ROOT_PASSWORD ?? ""})`);
      console.log("  Stop stack:   npm run docker:local:down");
      console.log("  View logs:    npm run docker:local:logs");
      return;
    }
    case "down": {
      const reset = rest.includes("--reset") || rest.includes("-v");
      const downArgs = ["down"];
      if (reset) downArgs.push("-v");
      runCompose(downArgs);
      return;
    }
    case "restart": {
      runCompose(["restart", ...rest]);
      return;
    }
    case "logs": {
      runCompose(["logs", "-f", ...rest]);
      return;
    }
    case "ps": {
      runCompose(["ps", ...rest]);
      return;
    }
    default: {
      console.error(`Unknown command: "${command}"`);
      printHelp();
      process.exit(1);
    }
  }
}

main();
