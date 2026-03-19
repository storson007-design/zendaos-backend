// Types shared across the WhatsApp abstraction layer

export interface IncomingMessage {
  from: string;      // WhatsApp phone number of the sender
  text: string;      // Plain text body
  messageId: string; // Provider-specific message ID (for dedup / read receipts)
}

export interface Button {
  id: string;
  title: string;
}

export interface WhatsAppProvider {
  sendMessage(to: string, text: string): Promise<void>;
  sendMessageWithButtons(to: string, text: string, buttons: Button[]): Promise<void>;
  parseIncomingWebhook(req: Request): IncomingMessage;
}
