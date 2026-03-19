// Central config — reads from environment variables
export const config = {
  port: process.env.PORT || 3000,

  // WhatsApp
  whatsappProvider: (process.env.WHATSAPP_PROVIDER || "360dialog") as
    | "360dialog"
    | "meta"
    | "mock",

  // 360dialog
  dialog360ApiKey: process.env.DIALOG360_API_KEY || "",
  dialog360BaseUrl:
    process.env.DIALOG360_BASE_URL || "https://waba.360dialog.io/v1",

  // Meta / Cloud API
  metaAccessToken: process.env.META_ACCESS_TOKEN || "",
  metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID || "",
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "",
  metaBaseUrl: "https://graph.facebook.com/v19.0",

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
};
