/**
 * Briefing handler — daily morning summary sent proactively via cron
 *
 * Runs at 8:00 AM per-user timezone using node-cron.
 * Groups users by timezone and schedules one job per distinct timezone.
 */
import cron from "node-cron";
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";

const DEFAULT_TZ = "America/Mexico_City";

function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

async function sendBriefingToUser(user: {
  id: string;
  phone: string;
  business_name: string | null;
  timezone: string | null;
}) {
  const tz = user.timezone || DEFAULT_TZ;

  // Build today's date range in the user's timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = formatter.format(now); // "YYYY-MM-DD"
  const todayStart = `${localDate}T00:00:00`;
  const todayEnd = `${localDate}T23:59:59`;

  const [{ data: appointments }, { count: pendingQuotes }] = await Promise.all([
    supabase
      .from("appointments")
      .select("client_name, starts_at, notes")
      .eq("user_id", user.id)
      .gte("starts_at", todayStart)
      .lte("starts_at", todayEnd)
      .neq("status", "cancelled")
      .order("starts_at"),
    supabase
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending"),
  ]);

  const name = user.business_name ?? "";
  const greeting = `Buenos días${name ? ` ${name}` : ""} 👋`;

  if (!appointments || appointments.length === 0) {
    await sendMessage(
      user.phone,
      `${greeting}\n\nHoy no tienes citas agendadas.`
    );
    return;
  }

  const lines = appointments
    .map((a) => `- ${formatTime(a.starts_at, tz)} ${a.client_name}`)
    .join("\n");

  let msg =
    `${greeting}\n\n` +
    `Hoy tienes ${appointments.length} cita${appointments.length > 1 ? "s" : ""}:\n` +
    lines;

  if (pendingQuotes && pendingQuotes > 0) {
    msg +=
      `\n\n${pendingQuotes} presupuesto${pendingQuotes > 1 ? "s pendientes" : " pendiente"} de respuesta.`;
  }

  await sendMessage(user.phone, msg);
}

async function runBriefingForTimezone(tz: string) {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, phone, business_name, timezone")
    .in("subscription_status", ["trial", "active"])
    .gte("onboarding_step", 4)
    .or(`timezone.eq.${tz},timezone.is.null`)
    .eq(tz === DEFAULT_TZ ? "timezone" : "timezone", tz === DEFAULT_TZ ? tz : tz);

  if (error || !users) {
    console.error(`[briefing] Failed to fetch users for tz ${tz}:`, error);
    return;
  }

  await Promise.allSettled(users.map((u) => sendBriefingToUser(u)));
}

/**
 * Sends daily briefing to all eligible users immediately.
 * Useful for ad-hoc triggers or testing.
 */
export async function sendDailyBriefingToAll() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, phone, business_name, timezone")
    .in("subscription_status", ["trial", "active"])
    .gte("onboarding_step", 4);

  if (error || !users) {
    console.error("[briefing] Failed to fetch users:", error);
    return;
  }

  await Promise.allSettled(users.map((u) => sendBriefingToUser(u)));
}

/**
 * Schedules the daily briefing cron jobs.
 * Groups users by timezone and fires at 08:00 in each.
 * Call once at server startup.
 */
export function scheduleBriefingCrons() {
  // Get all distinct timezones used in the DB, then schedule one job per tz.
  // We use a dynamic approach: query timezones at startup and refresh daily.

  async function scheduleAll() {
    const { data } = await supabase
      .from("users")
      .select("timezone")
      .in("subscription_status", ["trial", "active"]);

    const timezones = new Set<string>([DEFAULT_TZ]);
    (data ?? []).forEach((r) => {
      if (r.timezone) timezones.add(r.timezone);
    });

    for (const tz of timezones) {
      cron.schedule(
        "0 8 * * *",
        async () => {
          console.log(`[briefing] Sending daily briefing for tz: ${tz}`);
          await runBriefingForTimezone(tz);
        },
        { timezone: tz }
      );
      console.log(`[briefing] Scheduled 8:00 AM cron for timezone: ${tz}`);
    }
  }

  scheduleAll().catch((err) =>
    console.error("[briefing] Failed to schedule crons:", err)
  );
}
