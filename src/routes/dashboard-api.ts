/**
 * Dashboard REST API
 *
 * All routes require the user's phone number in the X-User-Phone header
 * (simple auth for MVP — replace with JWT/Supabase Auth in production).
 *
 * GET  /api/dashboard/summary        — KPI cards
 * GET  /api/dashboard/appointments   — upcoming appointments
 * GET  /api/dashboard/clients        — client list
 * GET  /api/dashboard/payments       — recent payments
 * GET  /api/dashboard/quotes         — quotes list
 * PATCH /api/dashboard/appointments/:id — update status
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.ts";

const router = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────
async function requireUser(req: Request, res: Response, next: NextFunction) {
  const phone = req.headers["x-user-phone"] as string | undefined;
  if (!phone) {
    res.status(401).json({ error: "Missing X-User-Phone header" });
    return;
  }
  const { data: user } = await supabase
    .from("users")
    .select("id, phone, business_name, subscription_status, onboarding_step")
    .eq("phone", phone)
    .maybeSingle();

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  (req as any).user = user;
  next();
}

router.use(requireUser);

// ── Summary (KPI cards) ────────────────────────────────────────────────────────
router.get("/summary", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayStart = new Date(now.toISOString().split("T")[0] + "T00:00:00").toISOString();
  const todayEnd = new Date(now.toISOString().split("T")[0] + "T23:59:59").toISOString();

  const [
    { count: todayCitas },
    { data: payments },
    { count: totalClients },
    { count: pendingQuotes },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .gte("starts_at", todayStart)
      .lte("starts_at", todayEnd),
    supabase
      .from("payments")
      .select("amount")
      .eq("user_id", userId)
      .gte("paid_at", monthStart),
    supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["draft", "sent"]),
  ]);

  const monthRevenue = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  res.json({
    todayAppointments: todayCitas ?? 0,
    monthRevenue,
    totalClients: totalClients ?? 0,
    pendingQuotes: pendingQuotes ?? 0,
  });
});

// ── Appointments ──────────────────────────────────────────────────────────────
router.get("/appointments", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { from, to, status } = req.query;

  let query = supabase
    .from("appointments")
    .select("*")
    .eq("user_id", userId)
    .order("starts_at");

  if (from) query = query.gte("starts_at", from as string);
  if (to) query = query.lte("starts_at", to as string);
  if (status) query = query.eq("status", status as string);

  const { data, error } = await query.limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.patch("/appointments/:id", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { status, notes } = req.body;

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabase
    .from("appointments")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── Clients ───────────────────────────────────────────────────────────────────
router.get("/clients", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { search } = req.query;

  let query = supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .order("name");

  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query.limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── Payments ──────────────────────────────────────────────────────────────────
router.get("/payments", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { from, to } = req.query;

  let query = supabase
    .from("payments")
    .select("*")
    .eq("user_id", userId)
    .order("paid_at", { ascending: false });

  if (from) query = query.gte("paid_at", from as string);
  if (to) query = query.lte("paid_at", to as string);

  const { data, error } = await query.limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── Quotes ────────────────────────────────────────────────────────────────────
router.get("/quotes", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.patch("/settings", async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { business_name, service_type, work_start, work_end, timezone } = req.body;

  const updates: Record<string, unknown> = {};
  if (business_name !== undefined) updates.business_name = business_name;
  if (service_type !== undefined) updates.service_type = service_type;
  if (work_start !== undefined) updates.work_start = work_start;
  if (work_end !== undefined) updates.work_end = work_end;
  if (timezone !== undefined) updates.timezone = timezone;

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", userId)
    .select(
      "phone, business_name, service_type, slug, onboarding_step, subscription_status, timezone"
    )
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

export default router;
