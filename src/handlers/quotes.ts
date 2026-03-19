/**
 * Quotes handler — create and manage presupuestos
 */
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";
import type { ParsedCommand } from "../parser/commandParser.ts";

export async function handleCreateQuote(
  userId: string,
  from: string,
  cmd: ParsedCommand
) {
  if (!cmd.service || !cmd.amount || !cmd.client) {
    await sendMessage(
      from,
      "Formato: _presupuesto [servicio] [monto] para [cliente]_\nEjemplo: _presupuesto masaje 500 para Ana_"
    );
    return;
  }

  // Find or create client
  let { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", userId)
    .ilike("name", `%${cmd.client}%`)
    .maybeSingle();

  if (!client) {
    const { data: newClient } = await supabase
      .from("clients")
      .insert({ user_id: userId, name: cmd.client })
      .select("id, name")
      .single();
    client = newClient;
  }

  if (!client) {
    await sendMessage(from, "Error al buscar o crear el cliente.");
    return;
  }

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      user_id: userId,
      client_id: client.id,
      client_name: client.name,
      service: cmd.service,
      amount: cmd.amount,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[quotes] insert error:", error);
    await sendMessage(from, "Error al crear el presupuesto.");
    return;
  }

  await sendMessage(
    from,
    `📋 *Presupuesto creado* (#${quote.id.slice(0, 8)})\n\n` +
      `👤 *Cliente:* ${client.name}\n` +
      `🔧 *Servicio:* ${cmd.service}\n` +
      `💵 *Monto:* $${cmd.amount.toLocaleString("es-MX")}\n` +
      `📊 *Estado:* Borrador\n\n` +
      `Responde *enviar presupuesto ${quote.id.slice(0, 8)}* para marcarlo como enviado.`
  );
}

export async function handleListQuotes(userId: string, from: string) {
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["draft", "sent"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !quotes || quotes.length === 0) {
    await sendMessage(from, "No tienes presupuestos activos.");
    return;
  }

  const statusEmoji: Record<string, string> = {
    draft: "📝",
    sent: "📤",
    accepted: "✅",
    rejected: "❌",
  };

  const lines = quotes.map(
    (q) =>
      `${statusEmoji[q.status] ?? "•"} *${q.client_name}* — ${q.service} — $${Number(q.amount).toLocaleString("es-MX")} _(${q.status})_`
  );

  await sendMessage(from, `📋 *Presupuestos activos*\n\n${lines.join("\n")}`);
}
