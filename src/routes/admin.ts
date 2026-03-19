import { Router, Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

// ── Middleware: validate admin secret ────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers["x-admin-secret"] as string | undefined;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAdmin);

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get("/stats", async (_req: Request, res: Response) => {
  const { data: all, error: e1 } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });

  const { count: totalUsers, error: e2 } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });

  const { count: activeUsers, error: e3 } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "active");

  if (e2 || e3) {
    res.status(500).json({ error: "DB error" });
    return;
  }

  const mrr = (activeUsers ?? 0) * 14;

  // recent registrations (last 10)
  const { data: recent, error: e4 } = await supabase
    .from("users")
    .select("id, phone, business_name, service_type, subscription_status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (e4) {
    res.status(500).json({ error: "DB error" });
    return;
  }

  res.json({
    totalUsers: totalUsers ?? 0,
    activeUsers: activeUsers ?? 0,
    mrr,
    recent: recent ?? [],
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get("/users", async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from("users")
    .select("id, phone, business_name, service_type, subscription_status, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    res.status(500).json({ error: "DB error" });
    return;
  }

  res.json({ users: data ?? [], total: count ?? 0, page, limit });
});

export default router;
