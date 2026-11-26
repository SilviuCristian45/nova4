// Prints the secrets docker-compose.yml needs, ready to paste into .env:  node scripts/gen-secrets.mjs
import { randomBytes } from "node:crypto";

console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`);
console.log(`JWT_ACCESS_SECRET=${randomBytes(48).toString("base64url")}`);
console.log(`MINIO_ROOT_USER=replog${randomBytes(6).toString("hex")}`);
console.log(`MINIO_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`);
console.log(`DRIVE_TOKEN_KEY=${randomBytes(32).toString("base64")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("hex")}`);
