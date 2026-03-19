/**
 * Stripe webhook route — POST /webhook/stripe
 *
 * Handles subscription lifecycle events to keep subscription_status in sync.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "../config/index.ts";
import { supabase } from "../lib/supabase.ts";

const router = Router();

// Raw body required for Stripe signature verification
router.post(
  "/stripe",
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;

    if (!config.stripeWebhookSecret) {
      console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set — skipping verification");
      res.sendStatus(200);
      return;
    }

    const stripe = new Stripe(config.stripeSecretKey);

    let event: Stripe.Event;
    try {
      // express.raw() gives a Buffer; fall back to stringified body
      const payload = Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(
        payload,
        sig,
        config.stripeWebhookSecret
      );
    } catch (err) {
      console.error("[stripe] Webhook signature verification failed:", err);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    try {
      await handleStripeEvent(event);
    } catch (err) {
      console.error("[stripe] Error handling event:", event.type, err);
    }

    res.sendStatus(200);
  }
);

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === "active" ? "active" : sub.status === "trialing" ? "trial" : "cancelled";
      await supabase
        .from("users")
        .update({ subscription_status: status })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await supabase
        .from("users")
        .update({ subscription_status: "cancelled" })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.CheckoutSession;
      if (session.customer && session.metadata?.user_phone) {
        await supabase
          .from("users")
          .update({
            stripe_customer_id: session.customer as string,
            subscription_status: "active",
          })
          .eq("phone", session.metadata.user_phone);
      }
      break;
    }

    default:
      // Unhandled event types are silently ignored
      break;
  }
}

export default router;
