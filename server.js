
"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    process.env.FRONTEND_URL
  ].filter(Boolean),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("OutLay backend is running!");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error("Razorpay environment variables are missing.");
  }

  return new Razorpay({ key_id, key_secret });
}

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
    console.error("Subscription creation failed:", error.message);

    return res.status(500).json({
      error: "Unable to create Razorpay subscription."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OutLay backend listening on port ${PORT}`);
});
