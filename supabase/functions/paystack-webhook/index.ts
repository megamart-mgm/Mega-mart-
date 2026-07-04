// supabase/functions/paystack-webhook/index.ts
//
// Receives Paystack's server-to-server webhook, verifies its signature using
// the PAYSTACK_SECRET_KEY (never exposed to the browser), and only then
// records a plan upgrade request. This replaces trusting the client-side
// Paystack callback, which can be faked from dev tools.
//
// Deploy with:
//   supabase functions deploy paystack-webhook --no-verify-jwt
// (--no-verify-jwt because Paystack calls this with no Supabase user JWT —
// it's authenticated by the signature check below instead.)
//
// Set the secret first:
//   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxxxxxxx
//
// Then in the Paystack dashboard: Settings → API Keys & Webhooks → Webhook URL:
//   https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service role client — this is what's allowed to bypass RLS and write
// plan_upgrade_requests. This key must NEVER be used in any HTML/JS file.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSignature === signatureHeader;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-paystack-signature");

  const isValid = await verifySignature(rawBody, signatureHeader);
  if (!isValid) {
    // Not from Paystack — reject immediately, do not process.
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // Log every verified event for debugging, before we even try to process it.
  const { data: logRow } = await supabase
    .from("payment_webhook_log")
    .insert({
      event_type: event.event,
      reference: event.data?.reference ?? null,
      raw_payload: event,
    })
    .select()
    .maybeSingle();

  try {
    if (event.event === "charge.success") {
      const data = event.data;
      const metadata = data.metadata || {};
      const amountNaira = data.amount / 100; // Paystack sends kobo

      if (metadata.purpose === "plan_upgrade" && metadata.seller_id && metadata.plan) {
        // Look up the seller's store
        const { data: store } = await supabase
          .from("stores")
          .select("id")
          .eq("seller_id", metadata.seller_id)
          .maybeSingle();

        if (!store) {
          throw new Error(`No store found for seller_id ${metadata.seller_id}`);
        }

        // Avoid inserting a duplicate if Paystack retries the webhook
        const { data: existing } = await supabase
          .from("plan_upgrade_requests")
          .select("id")
          .eq("paystack_reference", data.reference)
          .maybeSingle();

        if (!existing) {
          await supabase.from("plan_upgrade_requests").insert({
            seller_id: metadata.seller_id,
            store_id: store.id,
            requested_plan: metadata.plan,
            amount: amountNaira,
            currency: data.currency,
            paystack_reference: data.reference,
            billing_cycle: metadata.billing_cycle ?? null,
          });
        }
      }

      // Future payment types (digital product purchases, etc.) will branch
      // here on a different metadata.purpose value.
    }

    if (logRow) {
      await supabase.from("payment_webhook_log").update({ processed: true }).eq("id", logRow.id);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    if (logRow) {
      await supabase
        .from("payment_webhook_log")
        .update({ processed: false, error: String(err) })
        .eq("id", logRow.id);
    }
    // Still return 200 so Paystack doesn't hammer retries for a bug on our
    // side that a human needs to look at — the error is logged above.
    console.error("Webhook processing error:", err);
    return new Response(JSON.stringify({ received: true, error: String(err) }), { status: 200 });
  }
});
