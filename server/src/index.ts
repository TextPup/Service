import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import path from "node:path";
import fs from "node:fs";
import { initDatabase, db } from "./db/client.js";
import { systemConfig } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { setupRouter, runtimeSetupToken } from "./auth/setup.js";
import { authRouter } from "./auth/authRoutes.js";
import { threadsRouter } from "./routes/threads.js";
import { contactsRouter } from "./routes/contacts.js";
import { mediaRouter } from "./routes/media.js";
import { pushRouter } from "./routes/push.js";
import { eventsRouter } from "./routes/events.js";
import { statsRouter } from "./routes/stats.js";
import { gatewayRouter } from "./routes/gateway.js";
import { isVaultUnlocked, decryptField } from "./crypto/vault.js";

// Ensure database and tables exist
initDatabase();

const app = new Hono();

// Security headers
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "blob:", "data:"],
      mediaSrc: ["'self'", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  })
);

app.use(
  "*",
  cors({
    origin: (origin) => origin,
    credentials: true,
  })
);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", app: "TextPup" });
});

// Setup & Auth routes
app.route("/api/setup", setupRouter);
app.route("/api/auth", authRouter);

// Application API routes
app.route("/api/threads", threadsRouter);
app.route("/api/contacts", contactsRouter);
app.route("/api/media", mediaRouter);
app.route("/api/push", pushRouter);
app.route("/api/events", eventsRouter);
app.route("/api/stats", statsRouter);
app.route("/api/gateway", gatewayRouter);

// Locate static asset directory (Production /app/public or dev ../web/dist)
const candidateDirs = [
  process.env.PUBLIC_DIR,
  path.resolve(process.cwd(), "public"),
  path.resolve(process.cwd(), "../web/dist"),
  path.resolve(process.cwd(), "web/dist"),
].filter(Boolean) as string[];

const publicDir = candidateDirs.find((dir) => fs.existsSync(dir));

if (publicDir) {
  const relativeRoot = path.relative(process.cwd(), publicDir) || ".";
  app.use("/*", serveStatic({ root: relativeRoot }));

  // Fallback to index.html for SPA client-side routing
  app.get("*", (c) => {
    const indexPath = path.join(publicDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return c.html(fs.readFileSync(indexPath, "utf-8"));
    }
    return c.text("TextPup API Server Running");
  });
}

import { initHostWebSocket } from "./gateway/hostManager.js";

const port = Number(process.env.PORT) || 8080;

if (process.env.NODE_ENV !== "test") {
  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  if (!config || config.isInitialized === 0) {
    console.log("==================================================================");
    console.log("   TEXTPUP FIRST-RUN SETUP REQUIRED");
    console.log(`   X-Setup-Token: ${runtimeSetupToken}`);
    console.log("==================================================================");
  }

  console.log(`TextPup server listening on port ${port}...`);
  const server = serve({
    fetch: app.fetch,
    port,
  });
  initHostWebSocket(server as any);
}

export default app;



