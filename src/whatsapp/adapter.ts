import { config } from "../config/index.ts";
import type { Button, IncomingMessage } from "./types.ts";
import type { Request } from "express";
import * as dialog360 from "./providers/360dialog.ts";
import * as meta from "./providers/meta.ts";
import * as mock from "./providers/mock.ts";

// ─── Provider lookup ──────────────────────────────────────────────────────────
function getProvider() {
  if (config.whatsappProvider === "meta") return meta;
  if (config.whatsappProvider === "mock") return mock;
  return dialog360;
}

// ─── Public adapter interface ────────────────────────────────────────────────

export async function sendMessage(to: string, text: string): Promise<void> {
  return getProvider().sendMessage(to, text);
}

export async function sendMessageWithButtons(
  to: string,
  text: string,
  buttons: Button[]
): Promise<void> {
  return getProvider().sendMessageWithButtons(to, text, buttons);
}

export function parseIncomingWebhook(req: Request): IncomingMessage {
  return getProvider().parseIncomingWebhook(req);
}
