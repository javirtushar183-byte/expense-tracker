const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed frontend origins
const allowedOrigins = [
  "https://expensetrackeroutlay.netlify.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5501"
];

// CORS configuration
const allowedOrigins = [
  "https://expense-tracker-six-nu-96.vercel.app",
  "https://expensetrackeroutlay.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

// Parse JSON request bodies
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.send("OutLay backend is running!");
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Login required." });
    }

    // Verify the logged-in user's Supabase access token.
    const { data, error } =
      await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        error: "Invalid or expired login session."
      });
    }

    // Only the configured admin email can access the list.
    const adminEmail = (process.env.ADMIN_EMAIL || "")
      .trim()
      .toLowerCase();

    if (
      !adminEmail ||
      (data.user.email || "").toLowerCase() !== adminEmail
    ) {
      return res.status(403).json({
        error: "Admin access denied."
      });
    }

    // Fetch registered accounts, including pagination.
    const users = [];
    const perPage = 100;
    let page = 1;

    while (true) {
      const { data: result, error: listError } =
        await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage
        });

      if (listError) throw listError;

      users.push(
        ...result.users.map(user => ({
          id: user.id,
          email: user.email || "",
          fullName: user.user_metadata?.full_name || "",
          createdAt: user.created_at
        }))
      );

      if (result.users.length < perPage) break;
      page++;
    }

    return res.json({
      totalUsers: users.length,
      users
    });
  } catch (error) {
    console.error("Admin users error:", error.message);
    return res.status(500).json({
      error: "Could not load registered users."
    });
  }
});

// Initialize Razorpay securely on the backend
function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error("Razorpay environment variables are missing.");
  }

  return new Razorpay({
    key_id,
    key_secret
  });
}

// Create Razorpay subscription
app.post("/api/create-subscription", async (req, res) => {
  try {
    const planId = process.env.RAZORPAY_PLAN_ID;

    if (!planId) {
      return res.status(500).json({
        error: "RAZORPAY_PLAN_ID is not configured."
      });
    }

    const razorpay = getRazorpay();

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 12,
      quantity: 1,
      customer_notify: 1
    });

    return res.status(200).json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url
    });
  } catch (error) {
    console.error(
      "Subscription creation failed:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to create Razorpay subscription."
    });
  }
});

// Handle unexpected errors
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    error: "An unexpected server error occurred."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`OutLay backend listening on port ${PORT}`);
});
