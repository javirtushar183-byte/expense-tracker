
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env")
});

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = 3001;

app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501"
  ]
}));

// Webhook needs the original raw request body for signature verification.
app.post(
  "/api/razorpay-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!secret || !signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).send("Webhook configuration missing");
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return res.status(400).send("Invalid webhook signature");
    }

    try {
      const eventBody = JSON.parse(req.body.toString("utf8"));
      const event = eventBody.event;
      const payload = eventBody.payload || {};

      // Find subscription details from supported subscription events.
      const subscriptionEntity =
        payload.subscription?.entity ||
        payload.subscription?.entity;

      if (
        subscriptionEntity &&
        [
          "subscription.activated",
          "subscription.charged",
          "subscription.updated",
          "subscription.paused",
          "subscription.resumed",
          "subscription.cancelled",
          "subscription.halted"
        ].includes(event)
      ) {
        const subscription = subscriptionEntity;
        const userId = subscription.notes?.supabase_user_id;

        if (userId) {
          const { error } = await supabaseAdmin
            .from("customer_subscriptions")
            .upsert({
              user_id: userId,
              razorpay_subscription_id: subscription.id,
              plan_id: subscription.plan_id || null,
              status: subscription.status || event,
              current_start: subscription.current_start
                ? new Date(subscription.current_start * 1000).toISOString()
                : null,
              current_end: subscription.current_end
                ? new Date(subscription.current_end * 1000).toISOString()
                : null
            }, { onConflict: "user_id" });

          if (error) throw error;
        }
      }

      // Store payment events. User mapping is resolved through the
      // subscription record; never trust a user ID from a browser.
      const payment = payload.payment?.entity;

      if (
        payment &&
        ["payment.captured", "payment.failed"].includes(event)
      ) {
        const subscriptionId = payment.subscription_id || null;
        let userId = null;

        if (subscriptionId) {
          const { data, error } = await supabaseAdmin
            .from("customer_subscriptions")
            .select("user_id")
            .eq("razorpay_subscription_id", subscriptionId)
            .maybeSingle();

          if (error) throw error;
          userId = data?.user_id || null;
        }

        const { error } = await supabaseAdmin
          .from("payment_records")
          .upsert({
            razorpay_payment_id: payment.id,
            razorpay_subscription_id: subscriptionId,
            user_id: userId,
            amount_paise: Number(payment.amount || 0),
            currency: payment.currency || "INR",
            status: event === "payment.captured" ? "captured" : "failed",
            method: payment.method || null,
            created_at: payment.created_at
              ? new Date(payment.created_at * 1000).toISOString()
              : new Date().toISOString()
          }, { onConflict: "razorpay_payment_id" });

        if (error) throw error;
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Webhook processing error:", error.message);
      return res.status(500).send("Webhook processing failed");
    }
  }
);

app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase environment variables in .env");
}

const supabaseAdmin = createClient(
  supabaseUrl || "https://example.supabase.co",
  supabaseServiceKey || "missing-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are missing");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}

app.use((req, res, next) => {
  console.log("Request received:", req.method, req.url);
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/config-check", (req, res) => {
  res.json({
    keyIdPresent: Boolean(process.env.RAZORPAY_KEY_ID),
    keySecretPresent: Boolean(process.env.RAZORPAY_KEY_SECRET),
    monthlyPlanIdPresent: Boolean(process.env.RAZORPAY_MONTHLY_PLAN_ID),
    supabaseUrlPresent: Boolean(process.env.SUPABASE_URL),
    supabaseServiceKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    webhookSecretPresent: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
  });
});

// Verify a real Supabase access token.
async function getLoggedInUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) return null;
  return data.user;
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getLoggedInUser(req);

    if (!user) {
      return res.status(401).json({ error: "Please sign in" });
    }

    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(403).json({ error: "Admin access denied" });
    }

    req.adminUser = user;
    next();
  } catch (error) {
    console.error("Admin verification error:", error.message);
    res.status(500).json({ error: "Admin verification failed" });
  }
}

// Create a subscription for the signed-in user.
app.post("/api/create-subscription", async (req, res) => {
  try {
    const user = await getLoggedInUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Please sign in before subscribing"
      });
    }

    const planId = process.env.RAZORPAY_MONTHLY_PLAN_ID;

    if (!planId) {
      return res.status(500).json({ error: "Monthly plan is not configured" });
    }

    const razorpay = getRazorpay();

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 12,
      quantity: 1,
      customer_notify: 1,
      notes: {
        supabase_user_id: user.id,
        customer_email: user.email || ""
      }
    });

    // Save the mapping immediately so payment webhooks can identify the user.
    const { error } = await supabaseAdmin
      .from("customer_subscriptions")
      .upsert({
        user_id: user.id,
        razorpay_subscription_id: subscription.id,
        plan_id: planId,
        status: subscription.status || "created",
        current_start: null,
        current_end: null
      }, { onConflict: "user_id" });

    if (error) throw error;

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error("Create subscription error:", error.message);
    res.status(500).json({ error: "Could not create subscription" });
  }
});

// Real Supabase customers, with subscription information where available.
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 50;

    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) throw error;

    const users = data.users || [];
    const ids = users.map(user => user.id);
    let subscriptions = [];

    if (ids.length) {
      const result = await supabaseAdmin
        .from("customer_subscriptions")
        .select("user_id, razorpay_subscription_id, plan_id, status, current_start, current_end")
        .in("user_id", ids);

      if (result.error) throw result.error;
      subscriptions = result.data || [];
    }

    const byUser = new Map(subscriptions.map(s => [s.user_id, s]));

    res.json({
      page,
      users: users.map(user => {
        const subscription = byUser.get(user.id);

        return {
          customerId: user.id,
          name: user.user_metadata?.full_name || user.user_metadata?.name || "",
          email: user.email || "",
          joinedAt: user.created_at,
          lastSignInAt: user.last_sign_in_at || null,
          subscription: subscription || { status: "free" }
        };
      })
    });
  } catch (error) {
    console.error("Admin users error:", error.message);
    res.status(500).json({ error: "Could not load users" });
  }
});

// Latest 100 real payment records.
app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("payment_records")
      .select("razorpay_payment_id, razorpay_subscription_id, user_id, amount_paise, currency, status, method, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    res.json({
      payments: (data || []).map(payment => ({
        ...payment,
        amount: Number(payment.amount_paise || 0) / 100
      }))
    });
  } catch (error) {
    console.error("Admin payments error:", error.message);
    res.status(500).json({ error: "Could not load payments" });
  }
});

// Dashboard totals from actual database records.
app.get("/api/admin/summary", requireAdmin, async (req, res) => {
  try {
    const { data: usersData, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (usersError) throw usersError;

    const { data: subscriptions, error: subsError } =
      await supabaseAdmin
        .from("customer_subscriptions")
        .select("user_id, status");

    if (subsError) throw subsError;

    const { data: payments, error: paymentsError } =
      await supabaseAdmin
        .from("payment_records")
        .select("amount_paise, status");

    if (paymentsError) throw paymentsError;

    const activeStatuses = ["active", "authenticated"];
    const activeUserIds = new Set(
      (subscriptions || [])
        .filter(s => activeStatuses.includes(String(s.status).toLowerCase()))
        .map(s => s.user_id)
    );

    const successfulPayments = (payments || []).filter(
      p => ["captured", "paid", "success"].includes(String(p.status).toLowerCase())
    );

    res.json({
      usersOnPage: (usersData.users || []).length,
      premiumUsers: activeUserIds.size,
      freeUsers: Math.max(0, (usersData.users || []).length - activeUserIds.size),
      successfulPayments: successfulPayments.length,
      revenue: successfulPayments.reduce(
        (sum, p) => sum + Number(p.amount_paise || 0), 0
      ) / 100
    });
  } catch (error) {
    console.error("Admin summary error:", error.message);
    res.status(500).json({ error: "Could not load dashboard summary" });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
