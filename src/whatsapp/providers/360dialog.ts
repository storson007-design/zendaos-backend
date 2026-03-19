/**
 * 360dialog WhatsApp Business API provider
 * Docs: https://docs.360dialog.com/whatsapp-api/whatsapp-api/messaging
 *
 * Phase 1 — active provider
 */
import type { Request } from "express";
import { config } from "../../config/index.ts";
import type { Button, IncomingMessage } from "../types.ts";

const BASE_URL = config.dialog360BaseUrl;
const API_KEY = config.dialog360ApiKey;

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[360dialog] ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function sendMessage(to: string, text: string): Promise<void> {
  await post("/messages", {
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  });
}

export async function sendMessageWithButtons(
  to: string,
  text: string,
  buttons: Button[]
): Promise<void> {
  // 360dialog uses the interactive "button" message type
  await post("/messages", {
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

export function parseIncomingWebhook(req: Request): IncomingMessage {
  // 360dialog sends: { messages: [{ from, id, text: { body } }] }
  const body = req.body as {
    messages?: Array<{
      from: string;
      id: string;
      type: string;
      text?: { body: string };
      button?: { text: string };
    }>;
  };

  const msg = body?.messages?.[0];
  if (!msg) {
    throw new Error("[360dialog] No message found in webhook payload");
  }

  // Normalise text from different message types
  const text =
    msg.text?.body ??
    msg.button?.text ??
    "";

  return {
    from: msg.from,
    text,
    messageId: msg.id,
  };
}
