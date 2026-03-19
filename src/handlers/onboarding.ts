/**
 * Onboarding handler
 *
 * Step 0 → 1: Send welcome, ask business name
 * Step 1 → 2: Save name, ask service type (numbered list)
 * Step 2 → 3: Save service, ask schedule, generate slug, send final link
 */
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";

const SERVICE_TYPES = [
  "Fisioterapia",
  "Tatuajes y piercing",
  "Coaching / consultoría",
  "Belleza y estética",
  "Nutrición",
  "Psicología",
  "Otro",
];

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Returns true if the message was handled as part of onboarding.
 * Returns false when onboarding is already complete (caller should handle as command).
 */
export async function handleOnboarding(from: string, text: string): Promise<boolean> {
  const t = text.trim();

  // Fetch or create user record
  let { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone", from)
    .single();

  if (error && error.code === "PGRST116") {
    const { data: newUser, error: createError } = await supabase
      .from("users")
      .insert({ phone: from, onboarding_step: 0 })
      .select()
      .single();

    if (createError) {
      console.error("[onboarding] Failed to create user:", createError);
      return true;
    }
    user = newUser;
  } else if (error) {
    console.error("[onboarding] DB error:", error);
    return true;
  }

  if (!user) return true;

  // Already completed
  if (user.onboarding_step >= 4) return false;

  switch (user.onboarding_step) {
    case 0: {
      // Send welcome and ask for business name
      await sendMessage(
        from,
        "¡Hola! Soy *ZendaOS*, tu asistente de negocio por WhatsApp 👋\n\n" +
          "En menos de 2 minutos configuro tu agenda.\n\n" +
          "¿Cuál es el nombre de tu negocio?"
      );
      await supabase
        .from("users")
        .update({ onboarding_step: 1 })
        .eq("phone", from);
      return true;
    }

    case 1: {
      // Save business name, ask service type
      const businessName = t || "Mi negocio";

      await supabase
        .from("users")
        .update({ business_name: businessName, onboarding_step: 2 })
        .eq("phone", from);

      await sendMessage(
        from,
        `Perfecto, *${businessName}* ✅\n\n` +
          "¿Qué tipo de servicio ofreces?\n\n" +
          SERVICE_TYPES.map((s, i) => `${i + 1}. ${s}`).join("\n") +
          "\n\nResponde con el número o escribe tu tipo de servicio."
      );
      return true;
    }

    case 2: {
      // Save service type, ask schedule
      const idx = parseInt(t) - 1;
      const serviceType =
        !isNaN(idx) && idx >= 0 && idx < SERVICE_TYPES.length
          ? SERVICE_TYPES[idx]
          : t || "otro";

      await supabase
        .from("users")
        .update({ service_type: serviceType, onboarding_step: 3 })
        .eq("phone", from);

      await sendMessage(
        from,
        `Registrado como *${serviceType}* 👍\n\n` +
          "¿En qué horario trabajas?\n" +
          "Ejemplo: *9:00 - 18:00*"
      );
      return true;
    }

    case 3: {
      // Save schedule, generate slug, send final message
      // Re-fetch to get business_name
      const { data: freshUser } = await supabase
        .from("users")
        .select("business_name")
        .eq("phone", from)
        .single();

      const hoursMatch = t.match(/(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})/);
      const workStart = hoursMatch?.[1] ?? "09:00";
      const workEnd = hoursMatch?.[2] ?? "18:00";

      const businessName = freshUser?.business_name ?? "mi-negocio";
      const slug = toSlug(businessName);

      await supabase
        .from("users")
        .update({ work_start: workStart, work_end: workEnd, slug, onboarding_step: 4 })
        .eq("phone", from);

      await sendMessage(
        from,
        `Tu asistente está listo ✓\n\n` +
          `Comparte este link con tus clientes:\n` +
          `zendaos.com/agenda/${slug}\n\n` +
          `Escribe *ayuda* para ver todos los comandos.`
      );
      return true;
    }
  }

  return false;
}

/**
 * Returns the user record for a given phone number.
 * Creates it (step 0) if it doesn't exist yet.
 */
export async function getOrCreateUser(phone: string) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .single();

  if (error && error.code === "PGRST116") {
    const { data: newUser } = await supabase
      .from("users")
      .insert({ phone, onboarding_step: 0 })
      .select()
      .single();
    return newUser;
  }
  return data;
}
