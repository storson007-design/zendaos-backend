/**
 * Public booking page — GET /agenda/:slug
 * Booking endpoint  — POST /agenda/:slug/book
 *
 * Serves a mobile-first, zero-JS-required HTML page.
 * JS is only used to show the time-slot picker dynamically (progressive enhancement).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an array of Date objects for the next N days starting from tomorrow */
function nextDays(n: number, tz: string): string[] {
  const days: string[] = [];
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: tz })
  );
  for (let i = 1; i <= n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    // Return as YYYY-MM-DD in user's timezone
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push(`${yyyy}-${mm}-${dd}`);
  }
  return days;
}

/** Generate 1-hour slots between work_start and work_end (e.g. "09:00","10:00"...) */
function buildSlots(workStart: string, workEnd: string): string[] {
  const slots: string[] = [];
  const [sh, sm] = workStart.split(":").map(Number);
  const [eh] = workEnd.split(":").map(Number);
  let h = sh + (sm > 0 ? 1 : 0); // round up if not on the hour
  if (sm === 0) h = sh;
  while (h < eh) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    h++;
  }
  return slots;
}

/** ISO string for a given date (YYYY-MM-DD) + time ("HH:MM") in a timezone */
function toUTC(dateStr: string, timeStr: string, tz: string): Date {
  // Build a local datetime string and parse it
  const localStr = `${dateStr}T${timeStr}:00`;
  // Use Intl to get the UTC offset for that timezone on that day
  const local = new Date(localStr);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Get the offset by comparing what the tz thinks "now" is vs UTC
  const utcMs = local.getTime();
  const tzDateStr = new Date(localStr + "Z").toLocaleString("en-US", { timeZone: tz });
  const tzDate = new Date(tzDateStr);
  const diff = local.getTime() - tzDate.getTime();
  return new Date(utcMs + diff);
}

/** Format a date as "lun 17 mar", "mar 18 mar", etc. in Spanish */
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ─── GET /agenda/:slug ────────────────────────────────────────────────────────

router.get("/:slug", async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { booked: bookedMsg, error: errorMsg } = req.query as Record<string, string>;

  const { data: user } = await supabase
    .from("users")
    .select("id, business_name, service_type, work_start, work_end, timezone, agenda_slug")
    .eq("agenda_slug", slug)
    .maybeSingle();

  if (!user) {
    res.status(404).send(html404(slug));
    return;
  }

  const tz = user.timezone ?? "America/Mexico_City";
  const workStart: string = user.work_start ?? "09:00";
  const workEnd: string = user.work_end ?? "18:00";

  // Load all appointments for the next 14 days
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + 15);

  const { data: appointments } = await supabase
    .from("appointments")
    .select("starts_at")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .gte("starts_at", now.toISOString())
    .lte("starts_at", future.toISOString());

  // Build set of booked "YYYY-MM-DD HH:MM" strings in user's tz
  const bookedSet = new Set<string>();
  for (const appt of appointments ?? []) {
    const d = new Date(appt.starts_at);
    const localStr = d.toLocaleString("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // localStr: "03/17/2026, 10:00" → parse to "2026-03-17 10:00"
    const [datePart, timePart] = localStr.split(", ");
    const [mo, dy, yr] = datePart.split("/");
    const [hh, mm] = timePart.split(":");
    bookedSet.add(`${yr}-${mo}-${dy} ${hh}:${mm}`);
  }

  const allSlots = buildSlots(workStart, workEnd);
  const days = nextDays(14, tz);

  // Filter out fully-booked days
  const availableDays = days.filter((day) => {
    return allSlots.some((slot) => !bookedSet.has(`${day} ${slot}`));
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderPage({
      user,
      slug,
      availableDays,
      allSlots,
      bookedSet,
      bookedMsg,
      errorMsg,
      workStart,
      workEnd,
    })
  );
});

// ─── POST /agenda/:slug/book ──────────────────────────────────────────────────

router.post("/:slug/book", async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { client_name, client_phone, date, time } = req.body as Record<string, string>;

  // Validate inputs
  if (!client_name?.trim() || !client_phone?.trim() || !date || !time) {
    res.redirect(`/agenda/${slug}?error=Completa+todos+los+campos`);
    return;
  }

  const { data: user } = await supabase
    .from("users")
    .select("id, business_name, phone, timezone, work_start, work_end")
    .eq("agenda_slug", slug)
    .maybeSingle();

  if (!user) {
    res.status(404).send(html404(slug));
    return;
  }

  const tz = user.timezone ?? "America/Mexico_City";

  // Check slot is still free
  const startsAt = toUTC(date, time, tz);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const { data: conflict } = await supabase
    .from("appointments")
    .select("id")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .eq("starts_at", startsAt.toISOString())
    .maybeSingle();

  if (conflict) {
    res.redirect(`/agenda/${slug}?error=Ese+horario+ya+no+está+disponible`);
    return;
  }

  // Upsert client
  let clientId: string | null = null;
  const { data: existingClient } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .eq("phone", client_phone.trim())
    .maybeSingle();

  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await supabase
      .from("clients")
      .insert({ user_id: user.id, name: client_name.trim(), phone: client_phone.trim() })
      .select("id")
      .single();
    clientId = newClient?.id ?? null;
  }

  // Create appointment
  const { error: apptError } = await supabase.from("appointments").insert({
    user_id: user.id,
    client_id: clientId,
    client_name: client_name.trim(),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: "scheduled",
  });

  if (apptError) {
    res.redirect(`/agenda/${slug}?error=Error+al+agendar,+intenta+de+nuevo`);
    return;
  }

  // Notify business owner via WhatsApp
  const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const msg =
    `📅 Nueva cita agendada\n\n` +
    `Cliente: ${client_name.trim()}\n` +
    `Tel: ${client_phone.trim()}\n` +
    `Fecha: ${dayLabel}\n` +
    `Hora: ${time}`;

  try {
    await sendMessage(user.phone, msg);
  } catch {
    // Don't fail the booking if WhatsApp notification fails
  }

  res.redirect(`/agenda/${slug}?booked=${encodeURIComponent(client_name.trim())}`);
});

// ─── HTML rendering ───────────────────────────────────────────────────────────

interface RenderProps {
  user: { business_name: string; service_type: string };
  slug: string;
  availableDays: string[];
  allSlots: string[];
  bookedSet: Set<string>;
  bookedMsg?: string;
  errorMsg?: string;
  workStart: string;
  workEnd: string;
}

function renderPage(p: RenderProps): string {
  const { user, slug, availableDays, allSlots, bookedSet, bookedMsg, errorMsg } = p;

  const successBanner = bookedMsg
    ? `<div class="banner success">✓ ¡Listo, ${esc(bookedMsg)}! Tu cita fue agendada.</div>`
    : "";
  const errorBanner = errorMsg
    ? `<div class="banner error">⚠ ${esc(errorMsg)}</div>`
    : "";

  const dayOptions = availableDays
    .map((d) => `<option value="${d}">${formatDayLabel(d)}</option>`)
    .join("\n");

  // Pre-build slot availability JSON for the JS progressive enhancement
  const slotData: Record<string, string[]> = {};
  for (const day of availableDays) {
    slotData[day] = allSlots.filter((slot) => !bookedSet.has(`${day} ${slot}`));
  }
  const slotDataJson = JSON.stringify(slotData);

  // Fallback: show all slots (no-JS path shows a plain <select>)
  const firstDay = availableDays[0] ?? "";
  const firstSlots = firstDay ? (slotData[firstDay] ?? []) : [];
  const slotOptions = firstSlots
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("\n");

  const noAvailability = availableDays.length === 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agendar cita — ${esc(user.business_name)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --brand: #6366f1;
      --brand-dark: #4f46e5;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --border: #e2e8f0;
      --success-bg: #f0fdf4;
      --success-fg: #166534;
      --error-bg: #fef2f2;
      --error-fg: #991b1b;
      --radius: 12px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 0 0 48px;
    }

    header {
      background: var(--brand);
      color: #fff;
      padding: 28px 20px 24px;
      text-align: center;
    }
    header h1 { font-size: 1.4rem; font-weight: 700; }
    header p  { font-size: 0.9rem; opacity: 0.85; margin-top: 4px; }

    .container { max-width: 480px; margin: 0 auto; padding: 20px 16px 0; }

    .banner {
      border-radius: var(--radius);
      padding: 14px 16px;
      font-size: 0.92rem;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .banner.success { background: var(--success-bg); color: var(--success-fg); }
    .banner.error   { background: var(--error-bg);   color: var(--error-fg);   }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px 20px;
    }
    .card h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 18px;
      color: var(--text);
    }

    .field { margin-bottom: 16px; }
    .field label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .field input,
    .field select {
      width: 100%;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 1rem;
      color: var(--text);
      background: #fff;
      appearance: none;
      -webkit-appearance: none;
      outline: none;
      transition: border-color 0.15s;
    }
    .field input:focus,
    .field select:focus { border-color: var(--brand); }

    .select-wrap { position: relative; }
    .select-wrap::after {
      content: "▾";
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--muted);
      font-size: 1rem;
    }

    .btn {
      display: block;
      width: 100%;
      background: var(--brand);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 14px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }
    .btn:hover  { background: var(--brand-dark); }
    .btn:active { transform: scale(0.98); }

    .empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
    }
    .empty p { font-size: 1rem; }

    footer {
      text-align: center;
      margin-top: 28px;
      font-size: 0.78rem;
      color: var(--muted);
    }
    footer a { color: var(--brand); text-decoration: none; }
  </style>
</head>
<body>

<header>
  <h1>${esc(user.business_name)}</h1>
  <p>${esc(user.service_type ?? "")}</p>
</header>

<div class="container">
  ${successBanner}
  ${errorBanner}

  ${noAvailability ? `
  <div class="card">
    <div class="empty">
      <p>No hay citas disponibles en los próximos 14 días.<br>Por favor contacta directamente al negocio.</p>
    </div>
  </div>
  ` : `
  <div class="card">
    <h2>Reserva tu cita</h2>
    <form method="POST" action="/agenda/${slug}/book" id="booking-form">

      <div class="field">
        <label for="client_name">Tu nombre</label>
        <input type="text" id="client_name" name="client_name"
               placeholder="Ej. Ana López" required autocomplete="name">
      </div>

      <div class="field">
        <label for="client_phone">Tu teléfono (WhatsApp)</label>
        <input type="tel" id="client_phone" name="client_phone"
               placeholder="Ej. 5512345678" required autocomplete="tel">
      </div>

      <div class="field">
        <label for="date">Fecha</label>
        <div class="select-wrap">
          <select id="date" name="date" required>
            ${dayOptions}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="time">Hora</label>
        <div class="select-wrap">
          <select id="time" name="time" required>
            ${slotOptions}
          </select>
        </div>
      </div>

      <button type="submit" class="btn">Agendar cita</button>
    </form>
  </div>
  `}

  <footer>Powered by <a href="https://zendaos.com">ZendaOS</a></footer>
</div>

<script>
// Progressive enhancement: update time slots when the date changes
(function () {
  var slotData = ${slotDataJson};
  var dateSelect = document.getElementById('date');
  var timeSelect = document.getElementById('time');
  if (!dateSelect || !timeSelect) return;

  function updateSlots() {
    var day = dateSelect.value;
    var slots = slotData[day] || [];
    timeSelect.innerHTML = slots
      .map(function (s) { return '<option value="' + s + '">' + s + '</option>'; })
      .join('');
  }

  dateSelect.addEventListener('change', updateSlots);
  updateSlots();
})();
</script>

</body>
</html>`;
}

function html404(slug: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agenda no encontrada</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; background: #f8fafc; color: #1e293b; }
    .box { text-align: center; padding: 40px; }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    p  { color: #64748b; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Agenda no encontrada</h1>
    <p>No existe ninguna agenda con el enlace <strong>${esc(slug)}</strong>.</p>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default router;
