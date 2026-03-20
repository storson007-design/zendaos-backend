import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./src/config/index.ts";
import webhookRouter, { metaWebhookPost } from "./src/routes/webhook.ts";
import agendaPublicRouter from "./src/routes/agenda-public.ts";
import dashboardApiRouter from "./src/routes/dashboard-api.ts";
import stripeWebhookRouter from "./src/routes/stripe-webhook.ts";
import authRouter from "./src/routes/auth.ts";
import adminRouter from "./src/routes/admin.ts";
import { scheduleBriefingCrons } from "./src/handlers/briefing.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // for HTML form POST

// ── Landing page ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  const landingPath = path.join(__dirname, "landing", "index.html");
  res.sendFile(landingPath, (err) => {
    if (err) res.json({ status: "ok", service: "ZendaOS Backend" });
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", provider: config.whatsappProvider });
});

// Meta Cloud API sends POST directly to /webhook (no suffix)
app.post("/webhook", metaWebhookPost);

app.use("/webhook", webhookRouter);
app.use("/webhook", stripeWebhookRouter);
app.use("/agenda", agendaPublicRouter);
app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardApiRouter);
app.use("/api/admin", adminRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(
    `[zendaos] Server running on port ${config.port} | WhatsApp provider: ${config.whatsappProvider}`
  );
  scheduleBriefingCrons();
});
