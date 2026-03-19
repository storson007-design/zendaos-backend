/**
 * Agenda handler — appointment CRUD via WhatsApp commands
 */
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";
import type { ParsedCommand } from "../parser/commandParser.ts";

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns a date string "YYYY-MM-DD" for today or tomorrow in local timezone */
function resolveDate(dateHint?: string): string {
  const now = new Date();
  if (!dateHint || dateHint === "hoy") {
    return now.toISOString().split("T")[0];
  }
  if (dateHint === "mañana") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  // Try dd/mm or dd/mm/yyyy
  const parts = dateHint.split(/[\/\-]/);
  if (parts.length >= 2) {
    const day = parts[0].padStart(2, "0");
    const month = parts[1].padStart(2, "0");
    const year = parts[2] ? parts[2].padStart(4, "20") : now.getFullYear().toString();
    return `${year}-${month}-${day}`;
  }
  return now.toISOString().split("T")[0];
}

/** "10" / "10am" / "10:30" → "HH:MM:SS" */
function resolveTime(timeHint?: string): string {
  if (!timeHint) return "09:00:00";
  let str = timeHint.toLowerCase().replace("am", "").replace("pm", "");
  const isPm = timeHint.toLowerCase().includes("pm");
  const [h, m = "00"] = str.split(":");
  let hour = parseInt(h);
  if (isPm && hour < 12) hour += 12;
  return `${hour.toString().padStart(2, "0")}:${m.padStart(2, "0")}:00`;
}

function formatDateSpanish(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleCreateAppointment(
  userId: string,
  from: string,
  cmd: ParsedCommand
) {
  if (!cmd.clientName) {
    await sendMessage(from, "No entendí el nombre del cliente. Ejemplo:\n_agenda cita con Ana mañana a las 10am_");
    return;
  }

  const dateStr = resolveDate(cmd.date);
  const timeStr = resolveTime(cmd.time);
  const startsAt = `${dateStr}T${timeStr}`;

  // Upsert client
  let { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", cmd.clientName)
    .maybeSingle();

  if (!client) {
    const { data: newClient } = await supabase
      .from("clients")
      .insert({ user_id: userId, name: cmd.clientName })
      .select("id")
      .single();
    client = newClient;
  }

  const { error } = await supabase.from("appointments").insert({
    user_id: userId,
    client_id: client?.id,
    client_name: cmd.clientName,
    starts_at: startsAt,
    status: "scheduled",
  });

  if (error) {
    console.error("[agenda] insert error:", error);
    await sendMessage(from, "Ocurrió un error al agendar la cita. Intenta de nuevo.");
    return;
  }

  await sendMessage(
    from,
    `✅ Cita agendada\n👤 *${cmd.clientName}*\n📅 ${formatDateSpanish(startsAt)}\n🕐 ${formatTime(startsAt)}`
  );
}

export async function handleListAppointments(
  userId: string,
  from: string,
  day: "today" | "tomorrow" | "week"
) {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (day === "today") {
    start = new Date(now.toISOString().split("T")[0] + "T00:00:00");
    end = new Date(now.toISOString().split("T")[0] + "T23:59:59");
  } else if (day === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const ds = d.toISOString().split("T")[0];
    start = new Date(ds + "T00:00:00");
    end = new Date(ds + "T23:59:59");
  } else {
    // week: next 7 days
    start = new Date(now.toISOString().split("T")[0] + "T00:00:00");
    end = new Date(now);
    end.setDate(end.getDate() + 7);
  }

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("user_id", userId)
    .gte("starts_at", start.toISOString())
    .lte("starts_at", end.toISOString())
    .neq("status", "cancelled")
    .order("starts_at");

  if (error) {
    await sendMessage(from, "Error al consultar la agenda.");
    return;
  }

  if (!appointments || appointments.length === 0) {
    const label = day === "today" ? "hoy" : day === "tomorrow" ? "mañana" : "esta semana";
    await sendMessage(from, `No tienes citas ${label} 📭`);
    return;
  }

  const lines = appointments.map(
    (a) => `• ${formatTime(a.starts_at)} — *${a.client_name}*${a.notes ? ` _(${a.notes})_` : ""}`
  );

  const label = day === "today" ? "Hoy" : day === "tomorrow" ? "Mañana" : "Esta semana";
  await sendMessage(from, `📅 *${label}* (${appointments.length} cita${appointments.length > 1 ? "s" : ""})\n\n${lines.join("\n")}`);
}

export async function handleCancelAppointment(
  userId: string,
  from: string,
  cmd: ParsedCommand
) {
  if (!cmd.clientName) {
    await sendMessage(from, "Indica el nombre del cliente para cancelar su cita. Ejemplo:\n_cancelar cita con Ana_");
    return;
  }

  // Find the next upcoming appointment for this client
  const { data, error } = await supabase
    .from("appointments")
    .select("id, starts_at, client_name")
    .eq("user_id", userId)
    .ilike("client_name", `%${cmd.clientName}%`)
    .eq("status", "scheduled")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    await sendMessage(from, `No encontré citas próximas para *${cmd.clientName}*.`);
    return;
  }

  await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", data.id);

  await sendMessage(
    from,
    `❌ Cita cancelada\n👤 *${data.client_name}*\n📅 ${formatDateSpanish(data.starts_at)} a las ${formatTime(data.starts_at)}`
  );
}
