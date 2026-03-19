/**
 * Payments handler — register payments and update client totals
 */
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";
import type { ParsedCommand } from "../parser/commandParser.ts";

export async function handleRegisterPayment(
  userId: string,
  from: string,
  cmd: ParsedCommand
) {
  if (!cmd.name || !cmd.amount) {
    await sendMessage(from, "Formato: _Ana pagó 1200_  o  _cobrar 500 a Pedro_");
    return;
  }

  // Find or create client
  let { data: client } = await supabase
    .from("clients")
    .select("id, name, total_spent")
    .eq("user_id", userId)
    .ilike("name", `%${cmd.name}%`)
    .maybeSingle();

  if (!client) {
    const { data: newClient } = await supabase
      .from("clients")
      .insert({ user_id: userId, name: cmd.name, total_spent: 0 })
      .select("id, name, total_spent")
      .single();
    client = newClient;
  }

  if (!client) {
    await sendMessage(from, "Error al buscar o crear el cliente.");
    return;
  }

  // Insert payment record
  const { error } = await supabase.from("payments").insert({
    user_id: userId,
    client_id: client.id,
    client_name: client.name,
    amount: cmd.amount,
    description: cmd.raw,
  });

  if (error) {
    console.error("[payments] insert error:", error);
    await sendMessage(from, "Error al registrar el pago.");
    return;
  }

  // Update client total_spent
  await supabase
    .from("clients")
    .update({ total_spent: (client.total_spent ?? 0) + cmd.amount })
    .eq("id", client.id);

  await sendMessage(
    from,
    `💰 Pago registrado\n👤 *${client.name}*\n💵 $${cmd.amount.toLocaleString("es-MX")}\n📊 Total acumulado: $${((client.total_spent ?? 0) + cmd.amount).toLocaleString("es-MX")}`
  );
}

export async function handlePaymentSummary(userId: string, from: string) {
  // Last 30 days summary
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: payments, error } = await supabase
    .from("payments")
    .select("amount, client_name, paid_at")
    .eq("user_id", userId)
    .gte("paid_at", since.toISOString())
    .order("paid_at", { ascending: false });

  if (error || !payments || payments.length === 0) {
    await sendMessage(from, "No hay pagos registrados en los últimos 30 días.");
    return;
  }

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  const lines = payments
    .slice(0, 10)
    .map((p) => {
      const d = new Date(p.paid_at).toLocaleDateString("es-ES");
      return `• ${d} — *${p.client_name}* $${Number(p.amount).toLocaleString("es-MX")}`;
    })
    .join("\n");

  await sendMessage(
    from,
    `💰 *Últimos 30 días*\n\n${lines}${payments.length > 10 ? `\n... y ${payments.length - 10} más` : ""}\n\n*Total: $${total.toLocaleString("es-MX")}*`
  );
}
