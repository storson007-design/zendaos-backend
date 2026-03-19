/**
 * WhatsApp webhook route
 *
 * POST /webhook/whatsapp  — receives inbound messages from 360dialog or Meta
 * GET  /webhook/whatsapp  — Meta webhook verification challenge
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { parseIncomingWebhook } from "../whatsapp/adapter.ts";
import { config } from "../config/index.ts";
import { handleOnboarding, getOrCreateUser } from "../handlers/onboarding.ts";
import { parseCommand } from "../parser/commandParser.ts";
import {
  handleCreateAppointment,
  handleListAppointments,
  handleCancelAppointment,
} from "../handlers/agenda.ts";
import { handleGetClient, handleAddNote } from "../handlers/clients.ts";
import { handleRegisterPayment } from "../handlers/payments.ts";
import { handleCreateQuote } from "../handlers/quotes.ts";
import { sendMessage } from "../whatsapp/adapter.ts";

const router = Router();

const HELP_TEXT =
  `*ZendaOS — Comandos disponibles* 📋\n\n` +
  `🗓 *Agenda*\n` +
  `• _agenda cita con Ana mañana a las 10am_\n` +
  `• _agenda hoy_ / _agenda mañana_\n` +
  `• _cancelar cita con Ana_\n\n` +
  `👤 *Clientes*\n` +
  `• _cliente Ana García_\n` +
  `• _nota cliente Ana  llegó tarde_\n\n` +
  `💰 *Pagos*\n` +
  `• _Ana pagó 1200_\n` +
  `• _cobrar 500 a Pedro_\n\n` +
  `📋 *Presupuestos*\n` +
  `• _presupuesto masaje 500 para Ana_\n\n` +
  `⚙️ *Cuenta*\n` +
  `• _activar plan_`;

// ── Meta webhook verification (GET) ──────────────────────────────────────────
// Handles both /webhook and /webhook/whatsapp (Meta uses /webhook directly)
const metaVerifyHandler = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.metaVerifyToken) {
    res.status(200).send(challenge as string);
    return;
  }
  res.sendStatus(403);
};

router.get("/", metaVerifyHandler);
router.get("/whatsapp", metaVerifyHandler);

// ── Inbound message (POST) ────────────────────────────────────────────────────
// Meta Cloud API posts to /webhook (root), alias also on /webhook/whatsapp
const metaPostHandler = async (req: Request, res: Response) => {
  // Acknowledge immediately (providers retry on non-2xx)
  res.sendStatus(200);

  try {
      const message = parseIncomingWebhook(req);
      if (!message) return; // status update (delivered/read) — ignore
      if (!message.text) return;

    console.log(`[webhook] from=${message.from} text="${message.text}"`);

    // 1. Run onboarding first — returns true while still in flow
    const inOnboarding = await handleOnboarding(message.from, message.text);
    if (inOnboarding) return;

    // 2. Get user (guaranteed to exist after onboarding)
    const user = await getOrCreateUser(message.from);
    if (!user) return;

    // 3. Parse and dispatch command
    const cmd = parseCommand(message.text);

    switch (cmd.intent) {
      case "CREATE_APPOINTMENT":
        await handleCreateAppointment(user.id, message.from, cmd);
        break;
      case "LIST_TODAY":
        await handleListAppointments(user.id, message.from, "today");
        break;
      case "LIST_TOMORROW":
        await handleListAppointments(user.id, message.from, "tomorrow");
        break;
      case "LIST_WEEK":
        await handleListAppointments(user.id, message.from, "week");
        break;
      case "CANCEL_APPOINTMENT":
        await handleCancelAppointment(user.id, message.from, cmd);
        break;
      case "GET_CLIENT":
        await handleGetClient(user.id, message.from, cmd);
        break;
      case "ADD_NOTE":
        await handleAddNote(user.id, message.from, cmd);
        break;
      case "REGISTER_PAYMENT":
        await handleRegisterPayment(user.id, message.from, cmd);
        break;
      case "CREATE_QUOTE":
        await handleCreateQuote(user.id, message.from, cmd);
        break;
      case "ACTIVATE_PLAN":
        await sendMessage(
          message.from,
          "Para activar tu plan visita: https://app.zendaos.com/billing\nO escribe *ayuda* para más información."
        );
        break;
      case "HELP":
        await sendMessage(message.from, HELP_TEXT);
        break;
      default:
        await sendMessage(
          message.from,
          `No entendí ese comando 🤔\nEscribe *ayuda* para ver los comandos disponibles.`
        );
    }
  } catch (err) {
    console.error("[webhook] Unhandled error:", err);
  }
};

router.post("/", metaPostHandler);
router.post("/whatsapp", metaPostHandler);

export { metaPostHandler as metaWebhookPost };
export default router;
