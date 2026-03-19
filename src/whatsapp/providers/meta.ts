/**
 * Meta Cloud API (WhatsApp Business Platform) provider
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Phase 2 — becomes active when WHATSAPP_PROVIDER=meta
 */
import type { Request } from "express";
import { config } from "../../config/index.ts";
import type { Button, IncomingMessage } from "../types.ts";

async function post(path: string, body: unknown): Promise<void> {
  const url = `${config.metaBaseUrl}/${config.metaPhoneNumberId}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.metaAccessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[meta] ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function sendMessage(to: string, text: string): Promise<void> {
  await post("/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

export async function sendMessageWithButtons(
  to: string,
  text: string,
  buttons: Button[]
): Promise<void> {
  await post("/messages", {
    messaging_product: "whatsapp",
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
  // Meta sends: { entry: [{ changes: [{ value: { messages: [...] } }] }] }
  const body = req.body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            id: string;
            type: string;
            text?: { body: string };
            interactive?: {
              button_reply?: { id: string; title: string };
            };
          }>;
        };
      }>;
    }>;
  };

  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) {
    throw new Error("[meta] No message found in webhook payload");
  }

  const text =
    msg.text?.body ??
    msg.interactive?.button_reply?.title ??
    "";

  return {
    from: msg.from,
    text,
    messageId: msg.id,
  };
}
