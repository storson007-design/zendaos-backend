import type { Request } from "express";
import type { Button, IncomingMessage } from "../types.ts";

export async function sendMessage(to: string, text: string): Promise<void> {
  console.log(`[MOCK → ${to}]: ${text}`);
}

export async function sendMessageWithButtons(
  to: string,
  text: string,
  buttons: Button[]
): Promise<void> {
  const labels = buttons.map((b) => `[${b.title}]`).join(" ");
  console.log(`[MOCK → ${to}]: ${text} ${labels}`);
}

export function parseIncomingWebhook(req: Request): IncomingMessage {
  // Accepts both flat { from, text } and 360dialog native format
  const body = req.body as {
    from?: string;
    text?: string;
    messages?: Array<{ from: string; id: string; text?: { body: string } }>;
  };

  if (body?.messages?.[0]) {
    const msg = body.messages[0];
    return { from: msg.from, text: msg.text?.body ?? "", messageId: msg.id };
  }

  if (body?.from) {
    return { from: body.from, text: body.text ?? "", messageId: "mock-" + Date.now() };
  }

  throw new Error("[mock] No message found in webhook payload");
}
