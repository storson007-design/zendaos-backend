/**
 * Auth routes — OTP-based login
 *
 * POST /api/auth/send-otp   — sends a 6-digit code via WhatsApp
 * POST /api/auth/verify-otp — verifies the code and returns the user profile
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../whatsapp/adapter.ts";

const router = Router();

// POST /api/auth/send-otp
router.post("/send-otp", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) {
    res.status(400).json({ error: "phone required" });
    return;
  }

  // Only allow registered users
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (!user) {
    res
      .status(404)
      .json({ error: "Número no registrado. Escríbenos por WhatsApp primero." });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase
    .from("otp_codes")
    .insert({ phone, code, expires_at });

  if (insertError) {
    res.status(500).json({ error: "Error generando código. Inténtalo de nuevo." });
    return;
  }

  try {
    await sendMessage(
      phone,
      `Tu código de acceso a ZendaOS es: *${code}*\nExpira en 10 minutos.`
    );
  } catch (err) {
    console.error("[auth/send-otp] WhatsApp send failed:", err);
    // Still respond OK — code is stored, user can retry delivery via WhatsApp
  }

  res.json({ ok: true });
});

// POST /api/auth/verify-otp
router.post("/verify-otp", async (req: Request, res: Response) => {
  const { phone, code } = req.body as { phone?: string; code?: string };
  if (!phone || !code) {
    res.status(400).json({ error: "phone and code required" });
    return;
  }

  const { data: otp } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("phone", phone)
    .eq("code", code)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) {
    res.status(401).json({ error: "Código inválido o expirado" });
    return;
  }

  // Mark as used
  await supabase.from("otp_codes").update({ used: true }).eq("id", otp.id);

  const { data: user, error: userError } = await supabase
    .from("users")
    .select(
      "phone, business_name, service_type, slug, onboarding_step, subscription_status, timezone"
    )
    .eq("phone", phone)
    .single();

  if (userError || !user) {
    res.status(500).json({ error: "Error al obtener perfil de usuario" });
    return;
  }

  res.json({ user });
});

export default router;
