// supabase/functions/send-welcome-email/index.ts
//
// Sends a warm welcome email right after someone picks their role
// (buyer or seller) during signup. Called from the browser via
// supabaseClient.functions.invoke — the user's JWT is attached
// automatically, so this one does NOT need --no-verify-jwt.
//
// Deploy with:
//   supabase functions deploy send-welcome-email
//
// Set the secret first (get this from resend.com after verifying your domain):
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

// Until you verify your own domain in Resend, "from" must stay on Resend's
// sandbox address — Resend can't send as a @gmail.com address (Gmail's own
// anti-spoofing rules block it, and Resend has no DNS control over gmail.com
// to prove it's not spam). Replies are routed to your Gmail via reply-to, so
// you'll still get anything a person sends back in the meantime.
const FROM_ADDRESS = "Mega Mart <onboarding@resend.dev>";
const REPLY_TO_ADDRESS = "dben61168@gmail.com";
// Once you buy a domain and verify it in Resend, change FROM_ADDRESS to
// something like "Mega Mart <welcome@yourdomain.com>" and you can remove
// REPLY_TO_ADDRESS entirely if you want replies to go to that same inbox.

function buyerEmailHtml(firstName: string): string {
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0b1c30;">
      <h1 style="color: #006b2c; font-size: 22px;">Welcome to Mega Mart, ${firstName}! 🎉</h1>
      <p>We're really glad you're here. You now have full access to browse and buy from independent sellers all across Nigeria — physical products, digital goods, and services, all in one place.</p>
      <p style="margin-top: 20px;"><strong>A few things to try first:</strong></p>
      <ul style="padding-left: 20px; line-height: 1.8;">
        <li>Browse products by category, or search for something specific</li>
        <li>Tap into a product to see all its photos and full details</li>
        <li>Chat directly with a seller before you buy</li>
      </ul>
      <p style="margin-top: 24px;">If anything ever feels off or you need a hand, we're just a message away.</p>
      <p style="margin-top: 24px;">Happy shopping!<br/><strong>— The Mega Mart Team</strong></p>
    </div>
  `;
}

function sellerEmailHtml(firstName: string): string {
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0b1c30;">
      <h1 style="color: #006b2c; font-size: 22px;">Welcome aboard, ${firstName}! 🎉</h1>
      <p>You've just opened the door to your own store on Mega Mart — free to start, and ready to reach buyers across Nigeria.</p>
      <p style="margin-top: 20px;"><strong>Your next steps:</strong></p>
      <ul style="padding-left: 20px; line-height: 1.8;">
        <li>Set up your store name and details in Store Settings</li>
        <li>List your first product — physical, digital, or a service</li>
        <li>Every new listing is reviewed quickly before it goes live, so buyers can always trust what they see</li>
      </ul>
      <p style="margin-top: 24px;">You're starting on the Free plan (up to 5 listings) — upgrade any time as your store grows.</p>
      <p style="margin-top: 24px;">We're excited to see what you build.<br/><strong>— The Mega Mart Team</strong></p>
    </div>
  `;
}

Deno.serve(async (req) => {
  try {
    const { email, full_name, role } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "email is required" }), { status: 400 });
    }

    const firstName = (full_name || "there").trim().split(" ")[0];
    const isSeller = role === "seller";

    const subject = isSeller
      ? `Welcome to Mega Mart, ${firstName}! Let's set up your store 🚀`
      : `Welcome to Mega Mart, ${firstName}! 🎉`;

    const html = isSeller ? sellerEmailHtml(firstName) : buyerEmailHtml(firstName);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email,
        reply_to: REPLY_TO_ADDRESS,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", errText);
      return new Response(JSON.stringify({ sent: false, error: errText }), { status: 200 });
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err) {
    console.error("send-welcome-email error:", err);
    return new Response(JSON.stringify({ sent: false, error: String(err) }), { status: 200 });
  }
});
