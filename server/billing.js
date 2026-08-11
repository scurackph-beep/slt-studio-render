// Sweet Little Trauma Studio — facturación: Stripe y planes.
//
// Extraído de server/api-proxy.js sin modificar los cuerpos de las funciones.
// El estado y los helpers compartidos llegan por initBilling(), que api-proxy
// llama una vez al arrancar. Se hace así, y no con imports directos, porque
// billing y credits se necesitan mutuamente y el estado es un único objeto
// mutable que vive en api-proxy.

import crypto from "node:crypto";

let state;
let requestId;
let saveHistory;
let hasEnvValue;
let envNumber;
let envFlag;
let ledgerSnapshot;
let grantCreditsTransactional;
let adjustAvailableCreditsTransactional;
let markCompensationCouponRedeemed;
let processedWebhookEvents;

export function initBilling(context) {
  ({
    state,
    requestId,
    saveHistory,
    hasEnvValue,
    envNumber,
    envFlag,
    ledgerSnapshot,
    grantCreditsTransactional,
    adjustAvailableCreditsTransactional,
    markCompensationCouponRedeemed,
    processedWebhookEvents
  } = context);
}

const planCreditAllowance = {
  Free: 30,
  Pro: 1500,
  Studio: 5000,
  Business: 12000,
  Creator: 20000,
  Enterprise: 0
};

const planUsageRules = {
  Free: { maxVideoSeconds: 10, dailyVideoLimit: 3 },
  Pro: { maxVideoSeconds: 10, dailyVideoLimit: 20 },
  Studio: { maxVideoSeconds: 15, dailyVideoLimit: 60 },
  Business: { maxVideoSeconds: 30, dailyVideoLimit: 120 },
  Creator: { maxVideoSeconds: 60, dailyVideoLimit: 200 },
  Enterprise: { maxVideoSeconds: 300, dailyVideoLimit: 500 }
};

const creditPackCatalog = {
  credits_500: {
    id: "credits_500",
    name: "500 extra credits",
    credits: 500,
    amount: 3000,
    price: "$30",
    envKey: "STRIPE_PRICE_CREDITS_500"
  },
  credits_1000: {
    id: "credits_1000",
    name: "1,000 extra credits",
    credits: 1000,
    amount: 4900,
    price: "$49",
    envKey: "STRIPE_PRICE_CREDITS_1000"
  },
  credits_3000: {
    id: "credits_3000",
    name: "3,000 extra credits",
    credits: 3000,
    amount: 12900,
    price: "$129",
    envKey: "STRIPE_PRICE_CREDITS_3000"
  },
  credits_7500: {
    id: "credits_7500",
    name: "7,500 extra credits",
    credits: 7500,
    amount: 29900,
    price: "$299",
    envKey: "STRIPE_PRICE_CREDITS_7500"
  },
  credits_15000: {
    id: "credits_15000",
    name: "15,000 extra credits",
    credits: 15000,
    amount: 54900,
    price: "$549",
    envKey: "STRIPE_PRICE_CREDITS_15000"
  }
};

function creditsForPlan(plan = "Free") {
  return planCreditAllowance[plan] ?? planCreditAllowance.Free;
}

function usageRulesForPlan(plan = "Free") {
  return planUsageRules[plan] || planUsageRules.Free;
}

// Las suscripciones viven por tenant, igual que los wallets. No hay plan global:
// cada lectura y cada escritura tiene que nombrar el tenant al que pertenece.
function subscriptionForTenant(tenantId = state.wallet.tenantId, { create = true } = {}) {
  const normalizedTenantId = String(tenantId || state.wallet.tenantId || "demo-user");
  let subscription = state.subscriptions.find((item) => item.tenantId === normalizedTenantId) || null;
  if (!subscription && create) {
    subscription = {
      tenantId: normalizedTenantId,
      plan: "Free",
      status: "active",
      renewsAt: "",
      credits: creditsForPlan("Free"),
      heldCredits: 0,
      capturedCredits: 0,
      cancellationReason: "",
      stripeCustomerId: "",
      stripeSubscriptionId: ""
    };
    state.subscriptions.push(subscription);
  }
  return subscription;
}

function planForTenant(tenantId = state.wallet.tenantId) {
  return subscriptionForTenant(tenantId, { create: true }).plan || "Free";
}

function planForAuth(auth = {}) {
  return planForTenant(auth.tenantId || auth.userId || state.wallet.tenantId);
}

// Resuelve el tenant dueño de un customer de Stripe. Es lo que permite que un
// evento de suscripción o de factura, que sólo trae el customer, toque un único
// tenant en vez del estado global.
function tenantIdForStripeCustomer(customerId = "") {
  const normalized = String(customerId || "").trim();
  if (!normalized) return "";
  const owner = state.subscriptions.find((item) => item.stripeCustomerId === normalized);
  return owner?.tenantId || "";
}

function appendStripeParam(params, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendStripeParam(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => appendStripeParam(params, `${key}[${childKey}]`, childValue));
    return;
  }
  params.append(key, String(value));
}

async function stripeRequest(pathname, params = {}) {
  if (!hasEnvValue("STRIPE_SECRET_KEY")) {
    const error = new Error("Stripe setup required. Add STRIPE_SECRET_KEY in .env.");
    error.code = "stripe_setup_required";
    throw error;
  }
  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendStripeParam(form, key, value));
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.code = data.error?.code || data.error?.type || "stripe_error";
    throw error;
  }
  return data;
}

function stripePlanKey(plan = "", interval = "monthly") {
  const normalizedPlan = String(plan || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const normalizedInterval = String(interval || "monthly").toLowerCase().startsWith("year") ? "YEARLY" : "MONTHLY";
  return `STRIPE_PRICE_${normalizedPlan}_${normalizedInterval}`;
}

function stripePriceIdFor(plan = "", interval = "monthly") {
  return process.env[stripePlanKey(plan, interval)] || "";
}

function stripePlanStatus() {
  const planNames = ["Creator", "Pro", "Studio", "Business", "Enterprise"];
  return planNames.map((plan) => ({
    plan,
    monthlyEnv: stripePlanKey(plan, "monthly"),
    monthlyConfigured: Boolean(stripePriceIdFor(plan, "monthly")),
    yearlyEnv: stripePlanKey(plan, "yearly"),
    yearlyConfigured: Boolean(stripePriceIdFor(plan, "yearly"))
  }));
}

function stripeCreditPackStatus() {
  return Object.values(creditPackCatalog).map((pack) => ({
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    price: pack.price,
    envKey: pack.envKey,
    configured: Boolean(process.env[pack.envKey])
  }));
}

function creditPackById(packId = "") {
  return creditPackCatalog[packId] || null;
}

function stripeCreditPackPriceId(packId = "") {
  const pack = creditPackById(packId);
  return pack ? process.env[pack.envKey] || "" : "";
}



function stripeAutomaticTaxEnabled() {
  return envFlag("STRIPE_AUTOMATIC_TAX_ENABLED", false);
}

function stripeReturnUrl(kind = "success") {
  if (kind === "cancel") return process.env.STRIPE_CANCEL_URL || "http://127.0.0.1:4173/?stripe=cancel";
  return process.env.STRIPE_SUCCESS_URL || "http://127.0.0.1:4173/?stripe=success";
}

// El customer de Stripe pertenece al tenant, no al proceso. Sin tenant explícito
// sólo queda el valor de entorno, que existe para desarrollo local.
function currentStripeCustomerId(tenantId = "") {
  if (tenantId) {
    const subscription = subscriptionForTenant(tenantId, { create: true });
    return subscription.stripeCustomerId || process.env.STRIPE_CUSTOMER_ID || "";
  }
  return process.env.STRIPE_CUSTOMER_ID || "";
}

function stripeSetupStatus() {
  return {
    secretKeyPresent: hasEnvValue("STRIPE_SECRET_KEY"),
    webhookSecretPresent: hasEnvValue("STRIPE_WEBHOOK_SECRET"),
    publishableKeyPresent: hasEnvValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
    customerIdPresent: Boolean(currentStripeCustomerId()),
    automaticTaxEnabled: stripeAutomaticTaxEnabled(),
    prices: stripePlanStatus(),
    creditPacks: stripeCreditPackStatus()
  };
}

function stripeSetupError(message, code = "stripe_setup_required") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(String(signatureHeader).split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signatures = String(signatureHeader)
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || !signatures.length) throw new Error("Missing Stripe signature.");

  const timestampSeconds = Number(timestamp);
  const toleranceSeconds = envNumber("STRIPE_WEBHOOK_TOLERANCE_SECONDS", 300);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds) {
    throw new Error("Stripe signature timestamp outside tolerance.");
  }

  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
  if (!matched) throw new Error("Invalid Stripe signature.");
}

function allowUnsignedStripeWebhook(request) {
  const allowed = envFlag("STRIPE_WEBHOOK_ALLOW_UNSIGNED", false) || envFlag("ALLOW_UNSIGNED_STRIPE_WEBHOOKS", false);
  const productionAllowed = envFlag("STRIPE_WEBHOOK_ALLOW_UNSIGNED_IN_PRODUCTION", false);
  const host = String(request.header("host") || "");
  const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  return Boolean(allowed && (localHost || process.env.NODE_ENV !== "production" || productionAllowed));
}

function stripeRawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.body === "string") return Buffer.from(request.body, "utf8");
  return Buffer.from(JSON.stringify(request.body || {}), "utf8");
}

function stripeEventKey(event = {}) {
  const object = event.data?.object || {};
  return `stripe:${event.id || `${event.type || "event"}:${object.id || object.subscription || object.customer || "unknown"}`}`;
}

function stripeLineItems(object = {}) {
  const direct = object.lines?.data || object.line_items?.data || object.display_items || [];
  return Array.isArray(direct) ? direct : [];
}

function planFromStripePriceId(priceId = "") {
  if (!priceId) return "";
  for (const plan of Object.keys(planCreditAllowance)) {
    if (stripePriceIdFor(plan, "monthly") === priceId || stripePriceIdFor(plan, "yearly") === priceId) return plan;
  }
  return "";
}

function planFromStripeObject(object = {}, tenantId = "") {
  const line = stripeLineItems(object).find((item) => item?.metadata?.plan || item?.price?.id || item?.plan?.id) || {};
  const priceId = line.price?.id || line.plan?.id || object.price?.id || "";
  return object.metadata?.plan
    || object.subscription_details?.metadata?.plan
    || line.metadata?.plan
    || planFromStripePriceId(priceId)
    || (tenantId ? planForTenant(tenantId) : "")
    || "Free";
}

function creditPackFromStripeObject(object = {}) {
  const line = stripeLineItems(object).find((item) => item?.metadata?.creditPackId || item?.price?.id) || {};
  const packId = object.metadata?.creditPackId || line.metadata?.creditPackId || "";
  if (packId) return creditPackById(packId);
  const priceId = line.price?.id || object.price?.id || "";
  return Object.values(creditPackCatalog).find((pack) => process.env[pack.envKey] === priceId) || null;
}

function recordStripePaymentEvent(event, result = {}) {
  const object = event.data?.object || {};
  const tenantId = stripeTenantIdFromObject(object);
  state.paymentEvents.unshift({
    id: event.id || result.eventKey,
    eventKey: result.eventKey,
    type: event.type || "unknown",
    objectId: object.id || null,
    status: result.idempotent ? "duplicate_ignored" : "processed",
    actions: result.actions || [],
    tenantId: tenantId || null,
    stripeCustomerId: object.customer || null,
    wallet: result.wallet || (tenantId ? ledgerSnapshot(tenantId) : null),
    receivedAt: new Date().toISOString()
  });
  state.paymentEvents = state.paymentEvents.slice(0, 100);
}

async function handleStripeWebhook(request, response) {
  const rawBody = stripeRawBody(request);
  const signature = request.header("Stripe-Signature") || "";
  const unsignedAllowed = allowUnsignedStripeWebhook(request);

  if (!hasEnvValue("STRIPE_WEBHOOK_SECRET") && !unsignedAllowed) {
    response.status(503).json({
      ok: false,
      code: "stripe_webhook_not_configured",
      error: "Stripe webhook secret is missing."
    });
    return;
  }

  try {
    if (!unsignedAllowed) {
      verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    }
    const event = JSON.parse(rawBody.toString("utf8"));
    const result = await applyStripeWebhookEvent(event);
    response.json({
      ok: true,
      received: true,
      verified: !unsignedAllowed,
      idempotent: result.idempotent,
      actions: result.actions,
      wallet: result.wallet
    });
  } catch (_error) {
    response.status(400).json({
      ok: false,
      code: "stripe_webhook_verification_failed",
      error: "Stripe webhook verification failed."
    });
  }
}

// Devuelve "" cuando el evento no identifica a ningún tenant. Antes caía al
// tenant global, que era exactamente el camino por el que el pago de una cuenta
// terminaba cambiándole el plan a otra.
function stripeTenantIdFromObject(object = {}) {
  const declared =
    object.metadata?.tenantId ||
    object.metadata?.tenant_id ||
    object.subscription_details?.metadata?.tenantId ||
    object.subscription_details?.metadata?.tenant_id ||
    object.client_reference_id ||
    object.metadata?.userId ||
    "";
  if (declared) return String(declared);
  return tenantIdForStripeCustomer(object.customer);
}

async function applyStripeWebhookEvent(event = {}) {
  const object = event.data?.object || {};
  const eventKey = stripeEventKey(event);
  const tenantId = stripeTenantIdFromObject(object);
  if (processedWebhookEvents.has(eventKey)) {
    const result = {
      idempotent: true,
      eventKey,
      actions: ["duplicate_ignored"],
      tenantId: tenantId || null,
      wallet: tenantId ? ledgerSnapshot(tenantId) : null
    };
    recordStripePaymentEvent(event, result);
    return result;
  }

  // Sin tenant no se toca nada. El evento queda registrado para inspección, pero
  // no se le cambia el plan ni el saldo a nadie por descarte.
  if (!tenantId) {
    processedWebhookEvents.add(eventKey);
    const result = {
      idempotent: false,
      eventKey,
      actions: ["tenant_unresolved"],
      tenantId: null,
      wallet: null
    };
    recordStripePaymentEvent(event, result);
    return result;
  }

  processedWebhookEvents.add(eventKey);
  const subscription = subscriptionForTenant(tenantId, { create: true });
  const actions = [];

  try {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const paymentStatus = object.payment_status || "paid";
      const paymentConfirmed = ["paid", "no_payment_required"].includes(paymentStatus) || object.mode === "subscription";
      if (!paymentConfirmed) {
        actions.push("checkout_not_paid_yet");
      } else if (object.metadata?.type === "credit_pack") {
        const pack = creditPackFromStripeObject(object);
        const credits = Number(object.metadata?.credits || pack?.credits || 0);
        if (credits > 0) {
          const ledgerResult = await grantCreditsTransactional({
            amount: credits,
            tenantId,
            userId: object.metadata?.userId || null,
            idempotencyKey: `stripe:checkout:${object.id}:credit_pack`,
            reason: "credit_pack_purchase",
            metadata: { eventId: event.id || "", stripeSessionId: object.id, packId: pack?.id || object.metadata?.creditPackId || "" }
          });
          actions.push(ledgerResult.idempotent ? "credit_pack_duplicate" : "credit_pack_granted");
        }
        subscription.stripeCustomerId = object.customer || subscription.stripeCustomerId;
        saveHistory({
          id: requestId("credits"),
          kind: "billing",
          title: `Credit pack purchased: ${pack?.name || "extra credits"}`,
          provider: "Stripe",
          status: "paid",
          message: `${credits} extra credits added to the workspace.`,
          creditsAdded: credits,
          createdAt: new Date().toISOString()
        });
      } else {
        const plan = planFromStripeObject(object, tenantId);
        subscription.stripeCustomerId = object.customer || subscription.stripeCustomerId;
        subscription.stripeSubscriptionId = object.subscription || subscription.stripeSubscriptionId;
        subscription.plan = plan;
        subscription.status = "active";
        const ledgerResult = await adjustAvailableCreditsTransactional({
          targetAmount: creditsForPlan(plan),
          tenantId,
          userId: object.metadata?.userId || null,
          idempotencyKey: `stripe:checkout:${object.id}:subscription_allowance`,
          reason: "subscription_plan_credit_reset",
          metadata: { eventId: event.id || "", stripeSessionId: object.id, stripeSubscriptionId: object.subscription || "", plan }
        });
        actions.push(ledgerResult.idempotent ? "subscription_allowance_duplicate" : "subscription_allowance_applied");
        saveHistory({
          id: requestId("billing"),
          kind: "billing",
          title: "Stripe checkout completed",
          provider: "Stripe",
          status: "paid",
          message: "Stripe checkout completed and subscription state updated.",
          createdAt: new Date().toISOString()
        });
      }
      if (paymentConfirmed) {
        const redeemedCoupon = markCompensationCouponRedeemed(object);
        if (redeemedCoupon) actions.push("compensation_coupon_redeemed");
      }
    }

    if (event.type === "customer.subscription.deleted") {
      subscription.status = "cancelled";
      actions.push("subscription_cancelled");
      saveHistory({
        id: requestId("subscription"),
        kind: "subscription",
        title: "Stripe subscription cancelled",
        provider: "Stripe",
        status: "cancelled",
        message: "Stripe reported subscription cancellation.",
        createdAt: new Date().toISOString()
      });
    }

    if (event.type === "invoice.payment_failed") {
      state.billing.failedPayment = {
        amount: object.amount_due ? `$${(object.amount_due / 100).toFixed(2)}` : state.billing.failedPayment.amount,
        message: "Stripe reported a failed payment. Ask the customer to update their payment method."
      };
      actions.push("invoice_failed_recorded");
      saveHistory({
        id: requestId("billing"),
        kind: "billing",
        title: "Stripe payment failed",
        provider: "Stripe",
        status: "failed",
        message: state.billing.failedPayment.message,
        createdAt: new Date().toISOString()
      });
    }

    if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const plan = planFromStripeObject(object, tenantId);
      const amountPaid = object.amount_paid ?? object.total ?? 0;
      state.billing.invoices.unshift({
        id: object.number || object.id || requestId("invoice"),
        amount: amountPaid ? `$${(amountPaid / 100).toFixed(2)}` : "$0.00",
        status: "paid",
        date: new Date((object.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10)
      });
      state.billing.invoices = state.billing.invoices.slice(0, 20);
      if (object.subscription || plan !== "Free") {
        subscription.plan = plan;
        subscription.status = "active";
        subscription.stripeSubscriptionId = object.subscription || subscription.stripeSubscriptionId;
        subscription.stripeCustomerId = object.customer || subscription.stripeCustomerId;
        const periodStart = object.lines?.data?.[0]?.period?.start || object.period_start || object.created || "current";
        const ledgerResult = await adjustAvailableCreditsTransactional({
          targetAmount: creditsForPlan(plan),
          tenantId,
          userId: object.metadata?.userId || null,
          idempotencyKey: `stripe:invoice:${object.id || event.id}:${periodStart}:subscription_allowance`,
          reason: "subscription_invoice_credit_reset",
          metadata: { eventId: event.id || "", invoiceId: object.id || "", stripeSubscriptionId: object.subscription || "", plan, periodStart }
        });
        actions.push(ledgerResult.idempotent ? "invoice_allowance_duplicate" : "invoice_allowance_applied");
      } else {
        actions.push("invoice_recorded");
      }
    }

    const result = { idempotent: false, eventKey, actions, tenantId, wallet: ledgerSnapshot(tenantId) };
    recordStripePaymentEvent(event, result);
    return result;
  } catch (error) {
    processedWebhookEvents.delete(eventKey);
    throw error;
  }
}

export {
  planCreditAllowance,
  planUsageRules,
  creditPackCatalog,
  creditsForPlan,
  usageRulesForPlan,
  subscriptionForTenant,
  planForTenant,
  planForAuth,
  tenantIdForStripeCustomer,
  stripeRequest,
  stripePlanKey,
  stripePriceIdFor,
  stripePlanStatus,
  stripeCreditPackStatus,
  creditPackById,
  stripeCreditPackPriceId,
  stripeAutomaticTaxEnabled,
  stripeReturnUrl,
  currentStripeCustomerId,
  stripeSetupStatus,
  stripeSetupError,
  verifyStripeWebhookSignature,
  allowUnsignedStripeWebhook,
  stripeRawBody,
  stripeEventKey,
  stripeLineItems,
  planFromStripePriceId,
  planFromStripeObject,
  creditPackFromStripeObject,
  recordStripePaymentEvent,
  handleStripeWebhook,
  stripeTenantIdFromObject,
  applyStripeWebhookEvent
};
