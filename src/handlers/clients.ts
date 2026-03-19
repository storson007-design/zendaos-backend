/**
 * Clients handler — lookup and notes
 */
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";
import type { ParsedCommand } from "../parser/commandParser.ts";

export async function handleGetClient(userId: string, from: string, cmd: ParsedCommand) {
  if (!cmd.name) {
    await sendMessage(from, "Indica el nombre del cliente. Ejemplo:\n_cliente Ana García_");
    return;
  }

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", `%${cmd.name}%`)
    .order("created_at", { ascending: false })
    .limit(3);

  if (error || !clients || clients.length === 0) {
    await sendMessage(from, `No encontré clientes con el nombre *${cmd.name}*.`);
    return;
  }

  const c = clients[0];

  // Fetch last 3 appointments for this client
  const { data: appts } = await supabase
    .from("appointments")
    .select("starts_at, status")
    .eq("user_id", userId)
    .eq("client_id", c.id)
    .order("starts_at", { ascending: false })
    .limit(3);

  const apptLines =
    appts && appts.length > 0
      ? appts
          .map((a) => {
            const d = new Date(a.starts_at);
            return `  • ${d.toLocaleDateString("es-ES")} ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} (${a.status})`;
          })
          .join("\n")
      : "  Sin citas registradas";

  let msg =
    `👤 *${c.name}*\n` +
    (c.phone ? `📱 ${c.phone}\n` : "") +
    (c.email ? `✉️  ${c.email}\n` : "") +
    `💰 Total gastado: $${(c.total_spent ?? 0).toLocaleString("es-MX")}\n` +
    (c.notes ? `📝 Notas: ${c.notes}\n` : "") +
    `\n🗓 Últimas citas:\n${apptLines}`;

  if (clients.length > 1) {
    msg += `\n\n_(${clients.length - 1} resultado${clients.length > 2 ? "s" : ""} más — sé más específico si no es el correcto)_`;
  }

  await sendMessage(from, msg);
}

export async function handleAddNote(userId: string, from: string, cmd: ParsedCommand) {
  if (!cmd.name || !cmd.note) {
    await sendMessage(from, "Formato: _nota cliente NombreCliente  texto de la nota_\n(dos espacios entre nombre y nota)");
    return;
  }

  // Find client
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, notes")
    .eq("user_id", userId)
    .ilike("name", `%${cmd.name}%`)
    .maybeSingle();

  if (error || !client) {
    await sendMessage(from, `No encontré al cliente *${cmd.name}*. ¿Deseas crearlo? Usa:\n_agenda cita con ${cmd.name} ..._`);
    return;
  }

  // Append note with timestamp
  const existing = client.notes ?? "";
  const timestamp = new Date().toLocaleDateString("es-ES");
  const updated = existing
    ? `${existing}\n[${timestamp}] ${cmd.note}`
    : `[${timestamp}] ${cmd.note}`;

  await supabase
    .from("clients")
    .update({ notes: updated })
    .eq("id", client.id);

  await sendMessage(from, `✅ Nota guardada para *${client.name}*`);
}
