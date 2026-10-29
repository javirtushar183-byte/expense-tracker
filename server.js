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
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an Origin header, such as health checks
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("CORS blocked origin:", origin);
      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
  })
);

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
