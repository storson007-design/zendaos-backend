export type Intent =
  | "CREATE_APPOINTMENT"
  | "LIST_TODAY"
  | "LIST_TOMORROW"
  | "LIST_WEEK"
  | "CANCEL_APPOINTMENT"
  | "GET_CLIENT"
  | "ADD_NOTE"
  | "REGISTER_PAYMENT"
  | "CREATE_QUOTE"
  | "ACTIVATE_PLAN"
  | "HELP"
  | "UNKNOWN";

export interface ParsedCommand {
  intent: Intent;
  raw?: string;
  // Appointment fields
  clientName?: string;
  date?: string;
  time?: string;
  duration?: number;
  // Client fields
  name?: string;
  note?: string;
  // Payment fields
  amount?: number;
  // Quote fields
  service?: string;
  client?: string;
}

export function parseCommand(text: string): ParsedCommand {
  const t = text.toLowerCase().trim();

  // ── Agenda: crear cita ────────────────────────────────────────────────────
  // "agenda cita con María mañana a las 10" / "agenda cita Ana 15/03 11am"
  if (/^agenda\s+cita/.test(t)) {
    const nameMatch = t.match(/^agenda\s+cita\s+(?:con\s+)?([a-záéíóúüñ\s]+?)(?:\s+el\s+|\s+mañana|\s+hoy|\s+\d|$)/i);
      const timeMatch = t.match(/(?:a\s+las?\s+|@\s*|\s)(\d{1,2}(?::\d{2})?(?:am|pm))/i);
    const dateMatch = t.match(/(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/);
    const mañanaMatch = /mañana/.test(t);
    const hoyMatch = /\bhoy\b/.test(t);
    return {
      intent: "CREATE_APPOINTMENT",
      raw: t,
      clientName: nameMatch?.[1]?.trim(),
      date: dateMatch?.[1] ?? (mañanaMatch ? "mañana" : hoyMatch ? "hoy" : undefined),
      time: timeMatch?.[1],
    };
  }

  // ── Agenda: ver hoy ──────────────────────────────────────────────────────
  if (/^(qu[eé]\s+tengo\s+hoy|agenda\s+hoy|mis\s+citas\s+hoy|citas\s+hoy)/.test(t)) {
    return { intent: "LIST_TODAY" };
  }

  // ── Agenda: ver mañana ───────────────────────────────────────────────────
  if (/^(qu[eé]\s+tengo\s+ma[nñ]ana|agenda\s+ma[nñ]ana|citas\s+ma[nñ]ana)/.test(t)) {
    return { intent: "LIST_TOMORROW" };
  }

  // ── Agenda: ver semana ───────────────────────────────────────────────────
  if (/^(agenda\s+semana|esta\s+semana|citas\s+semana)/.test(t)) {
    return { intent: "LIST_WEEK" };
  }

  // ── Agenda: cancelar cita ────────────────────────────────────────────────
  // "cancelar cita con Ana / cancelar cita 15/03"
  if (/^cancelar\s+cita/.test(t)) {
    const nameMatch = t.match(/^cancelar\s+cita\s+(?:con\s+)?([a-záéíóúüñ\s]+)/i);
    return { intent: "CANCEL_APPOINTMENT", raw: t, clientName: nameMatch?.[1]?.trim() };
  }

  // ── Cliente: consultar ────────────────────────────────────────────────────
  if (/^cliente\s+(.+)/.test(t)) {
    const name = t.match(/^cliente\s+(.+)/)?.[1];
    return { intent: "GET_CLIENT", name };
  }

  // ── Cliente: agregar nota ─────────────────────────────────────────────────
  // "nota cliente Ana  texto de la nota"
  if (/^nota\s+cliente\s+/.test(t)) {
    const m =
      t.match(/^nota\s+cliente\s+(.+?)\s{2,}(.+)/) ||
      t.match(/^nota\s+cliente\s+(\w+)\s+(.+)/);
    if (m) {
      const [, name, note] = m;
      return { intent: "ADD_NOTE", name, note };
    }
  }

  // ── Pago: "Ana pagó 1200" / "cobra 500 a Pedro" ──────────────────────────
  const pagoMatch = t.match(/^(.+?)\s+pag[oó]\s+([\d,.]+)/);
  if (pagoMatch) {
    const [, name, amountRaw] = pagoMatch;
    return {
      intent: "REGISTER_PAYMENT",
      name: name.trim(),
      amount: parseFloat(amountRaw.replace(",", "")),
    };
  }
  const cobraMatch = t.match(/^cobra(?:r)?\s+([\d,.]+)\s+(?:a|de)\s+(.+)/);
  if (cobraMatch) {
    const [, amountRaw, name] = cobraMatch;
    return {
      intent: "REGISTER_PAYMENT",
      name: name.trim(),
      amount: parseFloat(amountRaw.replace(",", "")),
    };
  }

  // ── Presupuesto ───────────────────────────────────────────────────────────
  // "presupuesto masaje 500 para Ana" / "presupuesto Ana tattoo 1200"
  const presMatch = t.match(
    /^presupuesto\s+(.+?)\s+([\d,.]+)\s+para\s+(.+)/
  );
  if (presMatch) {
    const [, service, amountRaw, client] = presMatch;
    return {
      intent: "CREATE_QUOTE",
      service: service.trim(),
      amount: parseFloat(amountRaw.replace(",", "")),
      client: client.trim(),
    };
  }

  // ── Activar plan ─────────────────────────────────────────────────────────
  if (/^activar\s+plan/.test(t)) return { intent: "ACTIVATE_PLAN" };

  // ── Ayuda ─────────────────────────────────────────────────────────────────
  if (/^(ayuda|help|\?)/.test(t)) return { intent: "HELP" };

  return { intent: "UNKNOWN", raw: t };
}
