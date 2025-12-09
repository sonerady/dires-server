const express = require("express");
const { supabase } = require("../supabaseClient");

const router = express.Router();

const SUBSCRIPTION_PRODUCTS = [
  {
    ids: [
      "standard_weekly_600",
      "com.diress.standard.weekly.600",
      "com.monailisa.pro_weekly600",
    ],
    label: "Standard Weekly 600",
    planType: "standard",
    cadence: "weekly",
    credits: 600,
  },
  {
    ids: [
      "standard_monthly_2400",
      "com.diress.standard.monthly.2400",
      "com.monailisa.pro_monthly2400",
    ],
    label: "Standard Monthly 2400",
    planType: "standard",
    cadence: "monthly",
    credits: 2400,
  },
  {
    ids: ["plus_weekly_1200", "com.diress.plus.weekly.1200"],
    label: "Plus Weekly 1200",
    planType: "plus",
    cadence: "weekly",
    credits: 1200,
  },
  {
    ids: ["plus_monthly_4800", "com.diress.plus.monthly.4800"],
    label: "Plus Monthly 4800",
    planType: "plus",
    cadence: "monthly",
    credits: 4800,
  },
  {
    ids: ["premium_weekly_2400", "com.diress.premium.weekly.2400"],
    label: "Premium Weekly 2400",
    planType: "premium",
    cadence: "weekly",
    credits: 2400,
  },
  {
    ids: ["premium_monthly_9600", "com.diress.premium.monthly.9600"],
    label: "Premium Monthly 9600",
    planType: "premium",
    cadence: "monthly",
    credits: 9600,
  },
];

const COIN_PRODUCTS = [
  {
    ids: ["micro_1000", "com.micro.diress", "com.diress.micro.1000"],
    label: "Micro Pack 1000",
    credits: 1000,
  },
  {
    ids: ["small_2500", "com.small.diress", "com.diress.small.2500"],
    label: "Small Pack 2500",
    credits: 2500,
  },
  {
    ids: ["boost_5000", "com.boost.diress", "com.diress.boost.5000"],
    label: "Boost Pack 5000",
    credits: 5000,
  },
  {
    ids: ["growth_10000", "com.growth.diress", "com.diress.growth.10000"],
    label: "Growth Pack 10000",
    credits: 10000,
  },
  {
    ids: ["pro_15000", "com.pro.diress", "com.diress.pro.15000"],
    label: "Pro Pack 15000",
    credits: 15000,
  },
  {
    ids: [
      "enterprise_20000",
      "com.enterprise.diress",
      "com.diress.enterprise.20000",
    ],
    label: "Enterprise Pack 20000",
    credits: 20000,
  },
  {
    ids: ["com.monailisa.creditpack5000"],
    label: "Legacy Pack 5000",
    credits: 5000,
  },
  {
    ids: ["com.monailisa.creditpack1000"],
    label: "Legacy Pack 1000",
    credits: 1000,
  },
  {
    ids: ["com.monailisa.creditpack300"],
    label: "Legacy Pack 300",
    credits: 300,
  },
  {
    ids: ["com.monailisa.100coin"],
    label: "Legacy Pack 100",
    credits: 100,
  },
  {
    ids: ["test_product"],
    label: "Test Credits 1000",
    credits: 1000,
  },
];

const EVENT_LABELS = {
  INITIAL_PURCHASE: "Initial Purchase",
  NON_RENEWING_PURCHASE: "One-time Purchase",
  RENEWAL: "Renewal",
  CANCELLATION: "Cancellation",
  EXPIRATION: "Expiration",
  BILLING_ISSUE: "Billing Issue",
  PRODUCT_CHANGE: "Product Change",
  TEST: "Test Event",
};

const toTitleCase = (value = "") =>
  value
    .toString()
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatPlanTypeLabel = (planType) => {
  if (!planType) return null;
  const normalized = planType.toLowerCase();
  const labels = {
    standard: "Standard",
    plus: "Plus",
    premium: "Premium",
    basic: "Basic",
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
  };

  if (labels[normalized]) {
    return labels[normalized];
  }

  return toTitleCase(normalized.replace(/_/g, " "));
};

const matchProductDefinition = (productId, definitions, category) => {
  if (!productId) return null;
  const definition = definitions.find((item) => item.ids.includes(productId));
  if (definition) {
    return {
      ...definition,
      category,
    };
  }
  return null;
};

const resolveProductInfo = (productId = "") => {
  if (!productId) {
    return {
      label: "Unknown Product",
      category: "unknown",
      planType: null,
      cadence: null,
      credits: null,
    };
  }

  const subscriptionMatch = matchProductDefinition(
    productId,
    SUBSCRIPTION_PRODUCTS,
    "subscription"
  );

  if (subscriptionMatch) {
    return subscriptionMatch;
  }

  const coinMatch = matchProductDefinition(productId, COIN_PRODUCTS, "coin_pack");

  if (coinMatch) {
    return coinMatch;
  }

  const normalized = productId.toLowerCase();

  if (normalized.includes("weekly")) {
    return {
      label: toTitleCase(productId.replace(/\./g, " ")),
      category: "subscription",
      planType: "weekly",
      cadence: "weekly",
      credits: null,
    };
  }

  if (normalized.includes("monthly")) {
    return {
      label: toTitleCase(productId.replace(/\./g, " ")),
      category: "subscription",
      planType: "monthly",
      cadence: "monthly",
      credits: null,
    };
  }

  return {
    label: productId,
    category: "unknown",
    planType: null,
    cadence: null,
    credits: null,
  };
};

router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId || userId === "anonymous_user") {
    return res.status(400).json({
      success: false,
      message: "Valid user ID is required",
    });
  }

  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, credit_balance, is_pro, subscription_type, created_at")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("❌ [PURCHASE_SUMMARY] User fetch failed:", userError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user",
      });
    }

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { data: historyData, error: historyError } = await supabase
      .from("purchase_history")
      .select(
        "user_id, product_id, transaction_id, credits_added, price, currency, store, environment, event_type, purchased_at, created_at"
      )
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false });

    if (historyError) {
      console.error(
        "❌ [PURCHASE_SUMMARY] Purchase history query failed:",
        historyError
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch purchase history",
      });
    }

    const enrichedHistory = (historyData || []).map((record) => {
      const productInfo = resolveProductInfo(record.product_id);
      const eventLabel =
        EVENT_LABELS[record.event_type] ||
        toTitleCase((record.event_type || "").replace(/_/g, " "));
      const priceDisplay = record.price
        ? `${record.price} ${record.currency || ""}`.trim()
        : "Free";
      const storeDisplay = [record.store, record.environment]
        .filter(Boolean)
        .join(" • ");

      return {
        ...record,
        productLabel: productInfo.label,
        productCategory: productInfo.category,
        planType: productInfo.planType,
        cadence: productInfo.cadence,
        expectedCredits: productInfo.credits,
        eventLabel,
        priceDisplay,
        storeDisplay,
      };
    });

    const subscriptionPurchases = enrichedHistory.filter(
      (item) => item.productCategory === "subscription"
    );
    const coinPurchases = enrichedHistory.filter(
      (item) => item.productCategory === "coin_pack"
    );

    const lastSubscriptionPurchase = subscriptionPurchases[0] || null;

    const groupedSubscriptions = subscriptionPurchases.reduce(
      (acc, item) => {
        const existing = acc[item.product_id];
        const timestamp = item.purchased_at || item.created_at;

        if (!existing) {
          acc[item.product_id] = {
            productId: item.product_id,
            productLabel: item.productLabel,
            planType: item.planType,
            cadence: item.cadence,
            credits: item.expectedCredits || item.credits_added,
            lastEventType: item.event_type,
            lastEventLabel: item.eventLabel,
            lastPurchasedAt: timestamp,
            lastTransactionId: item.transaction_id,
            store: item.store,
            environment: item.environment,
          };
          return acc;
        }

        const existingTimestamp = existing.lastPurchasedAt;
        if (
          timestamp &&
          (!existingTimestamp || new Date(timestamp) > new Date(existingTimestamp))
        ) {
          acc[item.product_id] = {
            ...existing,
            lastEventType: item.event_type,
            lastEventLabel: item.eventLabel,
            lastPurchasedAt: timestamp,
            lastTransactionId: item.transaction_id,
            store: item.store,
            environment: item.environment,
          };
        }

        return acc;
      },
      {}
    );

    const activeSubscriptions = Object.values(groupedSubscriptions).sort(
      (a, b) =>
        new Date(b.lastPurchasedAt || 0) - new Date(a.lastPurchasedAt || 0)
    );

    const planLabelFromRecord = lastSubscriptionPurchase?.productLabel;
    const planLabelFromUser = formatPlanTypeLabel(userData.subscription_type);

    const subscriptionSummary = {
      isPro: Boolean(userData.is_pro),
      subscriptionType:
        userData.subscription_type || lastSubscriptionPurchase?.planType || null,
      planLabel:
        planLabelFromRecord ||
        planLabelFromUser ||
        (userData.is_pro ? "Pro" : "Free"),
      lastEventType: lastSubscriptionPurchase?.event_type || null,
      lastEventLabel: lastSubscriptionPurchase?.eventLabel || null,
      lastProductId: lastSubscriptionPurchase?.product_id || null,
      lastTransactionId: lastSubscriptionPurchase?.transaction_id || null,
      lastStore: lastSubscriptionPurchase?.store || null,
      lastEnvironment: lastSubscriptionPurchase?.environment || null,
      lastPurchasedAt: lastSubscriptionPurchase?.purchased_at || null,
      totalCreditsFromSubscriptions: subscriptionPurchases.reduce(
        (sum, item) => sum + (item.credits_added || 0),
        0
      ),
      totalCreditsFromCoinPacks: coinPurchases.reduce(
        (sum, item) => sum + (item.credits_added || 0),
        0
      ),
      activeSubscriptions,
    };

    const stats = {
      totalPurchases: enrichedHistory.length,
      totalCreditsAdded: enrichedHistory.reduce(
        (sum, item) => sum + (item.credits_added || 0),
        0
      ),
      subscriptionPurchaseCount: subscriptionPurchases.length,
      coinPurchaseCount: coinPurchases.length,
      lastPurchaseAt: enrichedHistory[0]?.purchased_at || null,
      uniqueProducts: Array.from(
        new Set(enrichedHistory.map((item) => item.product_id))
      ),
    };

    return res.json({
      success: true,
      data: {
        user: {
          id: userData.id,
          creditBalance: userData.credit_balance,
          isPro: userData.is_pro,
          subscriptionType: userData.subscription_type,
          createdAt: userData.created_at,
          updatedAt: null,
        },
        subscriptionSummary,
        purchaseHistory: enrichedHistory,
        stats,
      },
    });
  } catch (error) {
    console.error("❌ [PURCHASE_SUMMARY] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = router;
