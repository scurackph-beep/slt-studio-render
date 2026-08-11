// Sweet Little Trauma Studio — créditos: el libro mayor.
//
// Extraído de server/api-proxy.js sin modificar los cuerpos de las funciones.
// Igual que billing.js, recibe el estado y los helpers compartidos por
// initCredits(). Importa de billing.js directamente porque billing no importa
// este módulo: recibe lo que necesita del ledger por inyección.

import { subscriptionForTenant } from "./billing.js";

let state;
let requestId;
let envNumber;
let getAuth;
let isGuestAuth;
let isOwnerAuth;
let requestIdentity;
let runtimeStore;

export function initCredits(context) {
  ({
    state,
    requestId,
    envNumber,
    getAuth,
    isGuestAuth,
    isOwnerAuth,
    requestIdentity,
    runtimeStore
  } = context);
}

function creditAccount(name) {
  return `Tenant.${name}`;
}

function walletForTenant(tenantId = state.wallet.tenantId, { create = true, initialCredits = 0 } = {}) {
  const normalizedTenantId = String(tenantId || state.wallet.tenantId || "demo-user");
  let wallet = state.wallets.find((item) => item.tenantId === normalizedTenantId) || null;
  if (!wallet && state.wallet?.tenantId === normalizedTenantId) {
    wallet = state.wallet;
    state.wallets.push(wallet);
  }
  if (!wallet && create) {
    wallet = {
      tenantId: normalizedTenantId,
      availableCredits: Math.max(0, Number(initialCredits) || 0),
      heldCredits: 0,
      capturedCredits: 0
    };
    state.wallets.push(wallet);
  }
  return wallet;
}


function ledgerSnapshot(tenantId = state.wallet.tenantId) {
  const wallet = walletForTenant(tenantId, { create: true });
  return {
    tenantId: wallet.tenantId,
    availableCredits: wallet.availableCredits,
    heldCredits: wallet.heldCredits,
    capturedCredits: wallet.capturedCredits,
    transactionCount: state.creditTransactions.filter((item) => item.tenantId === wallet.tenantId).length,
    reservationCount: state.creditReservations.filter((item) => item.tenantId === wallet.tenantId).length
  };
}

function syncCreditViews(tenantId = state.wallet.tenantId) {
  const wallet = walletForTenant(tenantId, { create: true });
  const subscription = subscriptionForTenant(wallet.tenantId, { create: true });
  subscription.credits = wallet.availableCredits;
  subscription.heldCredits = wallet.heldCredits;
  subscription.capturedCredits = wallet.capturedCredits;
  if (state.wallet.tenantId === wallet.tenantId) {
    state.wallet = wallet;
    state.user.credits = wallet.availableCredits;
  }
  return ledgerSnapshot(wallet.tenantId);
}

function findCreditTransactionByIdempotency(idempotencyKey = "") {
  return state.creditTransactions.find((transaction) => transaction.idempotencyKey === idempotencyKey) || null;
}

function appendCreditTransaction({
  type,
  amount,
  debitAccount,
  creditAccount: creditedAccount,
  idempotencyKey,
  reservationId = null,
  jobId = null,
  tenantId = state.wallet.tenantId,
  status = "posted",
  metadata = {},
  availableDelta = 0,
  heldDelta = 0,
  capturedDelta = 0
}) {
  const existing = findCreditTransactionByIdempotency(idempotencyKey);
  if (existing) return { transaction: existing, idempotent: true, wallet: ledgerSnapshot(existing.tenantId || tenantId) };
  const wallet = walletForTenant(tenantId, { create: true });

  const transaction = {
    id: requestId("credit_tx"),
    idempotencyKey,
    idempotency_key: idempotencyKey,
    type,
    status,
    amount,
    reservationId,
    jobId,
    tenantId,
    entries: [
      { account: debitAccount, direction: "debit", amount },
      { account: creditedAccount, direction: "credit", amount }
    ],
    balanceDeltas: {
      availableCredits: availableDelta,
      heldCredits: heldDelta,
      capturedCredits: capturedDelta
    },
    metadata,
    createdAt: new Date().toISOString()
  };

  wallet.availableCredits += availableDelta;
  wallet.heldCredits += heldDelta;
  wallet.capturedCredits += capturedDelta;
  if (wallet.availableCredits < 0 || wallet.heldCredits < 0) {
    wallet.availableCredits -= availableDelta;
    wallet.heldCredits -= heldDelta;
    wallet.capturedCredits -= capturedDelta;
    const error = new Error("Credit ledger would produce a negative balance.");
    error.code = "negative_ledger_balance";
    error.statusCode = 409;
    throw error;
  }

  state.creditTransactions.unshift(transaction);
  state.creditTransactions = state.creditTransactions.slice(0, 500);
  syncCreditViews(tenantId);
  return { transaction, idempotent: false, wallet: ledgerSnapshot(tenantId) };
}

function grantCredits({ amount, idempotencyKey, reason = "credit_grant", metadata = {}, tenantId = state.wallet.tenantId }) {
  if (!amount) return { transaction: null, wallet: ledgerSnapshot(tenantId), skipped: true };
  return appendCreditTransaction({
    type: reason,
    amount: Math.abs(amount),
    debitAccount: "SLT.CreditIssuer",
    creditAccount: creditAccount("Available"),
    idempotencyKey,
    tenantId,
    status: "posted",
    metadata,
    availableDelta: Math.abs(amount)
  });
}

function adjustAvailableCredits({ targetAmount, idempotencyKey, reason = "plan_credit_adjustment", metadata = {}, tenantId = state.wallet.tenantId }) {
  const target = Math.max(0, Number(targetAmount) || 0);
  const wallet = walletForTenant(tenantId, { create: true });
  const delta = target - wallet.availableCredits;
  if (delta === 0) return { transaction: null, wallet: ledgerSnapshot(tenantId), skipped: true };
  if (delta > 0) {
    return grantCredits({ amount: delta, idempotencyKey, reason, metadata, tenantId });
  }
  return appendCreditTransaction({
    type: reason,
    amount: Math.abs(delta),
    debitAccount: creditAccount("Available"),
    creditAccount: "SLT.CreditExpiry",
    idempotencyKey,
    tenantId,
    status: "posted",
    metadata,
    availableDelta: delta
  });
}

function findCreditReservation(reservationId = "") {
  return state.creditReservations.find((reservation) => reservation.id === reservationId) || null;
}

function reserveCredits({ amount, kind, auth, request, idempotencyKey, metadata = {}, initialCredits = 0 }) {
  const cost = Math.max(0, Number(amount) || 0);
  const tenantId = requestIdentity(request, auth);
  const wallet = walletForTenant(tenantId, { create: true, initialCredits });
  if (!cost) {
    return {
      reservation: null,
      transaction: null,
      wallet: ledgerSnapshot(tenantId),
      skipped: true,
      message: "No reservation needed for zero-credit operation."
    };
  }

  const existingTransaction = findCreditTransactionByIdempotency(idempotencyKey);
  if (existingTransaction?.reservationId) {
    return {
      reservation: findCreditReservation(existingTransaction.reservationId),
      transaction: existingTransaction,
      wallet: ledgerSnapshot(tenantId),
      idempotent: true
    };
  }

  if (wallet.availableCredits < cost) {
    const error = new Error("Insufficient Credits");
    error.code = "insufficient_credits";
    error.statusCode = 402;
    error.readableError = "You do not have enough credits for this action.";
    throw error;
  }

  const reservation = {
    id: requestId("reservation"),
    tenantId,
    kind,
    amount: cost,
    status: "reserved",
    idempotencyKey,
    idempotency_key: idempotencyKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    capturedAt: null,
    releasedAt: null,
    jobId: metadata.jobId || null,
    metadata
  };
  state.creditReservations.unshift(reservation);
  state.creditReservations = state.creditReservations.slice(0, 300);

  const result = appendCreditTransaction({
    type: "reserve",
    amount: cost,
    debitAccount: creditAccount("Available"),
    creditAccount: creditAccount("HeldByReservation"),
    idempotencyKey,
    reservationId: reservation.id,
    jobId: metadata.jobId || null,
    tenantId,
    status: "reserved",
    metadata,
    availableDelta: -cost,
    heldDelta: cost
  });
  return { reservation, transaction: result.transaction, wallet: result.wallet, idempotent: result.idempotent };
}

function resolveReservation({ reservationId, outcome, jobId = null, idempotencyKey, reason = "" }) {
  const reservation = findCreditReservation(reservationId);
  if (!reservation) {
    return { reservation: null, transaction: null, wallet: null, skipped: true, reason: "reservation_not_found" };
  }
  if (["captured", "released"].includes(reservation.status)) {
    return { reservation, transaction: findCreditTransactionByIdempotency(idempotencyKey), wallet: ledgerSnapshot(reservation.tenantId), idempotent: true };
  }

  const capture = outcome === "capture";
  const transaction = appendCreditTransaction({
    type: capture ? "capture" : "release",
    amount: reservation.amount,
    debitAccount: creditAccount("HeldByReservation"),
    creditAccount: capture ? "SLT.CapturedRevenue" : creditAccount("Available"),
    idempotencyKey,
    reservationId,
    jobId: jobId || reservation.jobId,
    tenantId: reservation.tenantId,
    status: capture ? "captured" : "released",
    metadata: { reason, originalReservationKey: reservation.idempotencyKey },
    availableDelta: capture ? 0 : reservation.amount,
    heldDelta: -reservation.amount,
    capturedDelta: capture ? reservation.amount : 0
  });

  reservation.status = capture ? "captured" : "released";
  reservation.updatedAt = new Date().toISOString();
  reservation.jobId = jobId || reservation.jobId;
  if (capture) reservation.capturedAt = reservation.updatedAt;
  else reservation.releasedAt = reservation.updatedAt;
  return { reservation, transaction: transaction.transaction, wallet: transaction.wallet, idempotent: transaction.idempotent };
}

function initialCreditsForAuth(auth = {}) {
  if (isOwnerAuth(auth)) return envNumber("CEO_INTERNAL_CREDITS", 1_000_000);
  if (isGuestAuth(auth)) return envNumber("GUEST_INTERNAL_CREDITS", 10_000);
  if (auth.userId === state.wallet.tenantId || auth.tenantId === state.wallet.tenantId) {
    return state.wallet.availableCredits;
  }
  return envNumber("NEW_TENANT_STARTING_CREDITS", 0);
}

function mirrorLedgerResult(result = {}) {
  const reservation = result.reservation;
  const transaction = result.transaction;
  const wallet = result.wallet;
  if (reservation?.id) {
    const index = state.creditReservations.findIndex((item) => item.id === reservation.id);
    if (index === -1) state.creditReservations.unshift(reservation);
    else state.creditReservations[index] = { ...state.creditReservations[index], ...reservation };
  }
  if (transaction?.id) {
    const index = state.creditTransactions.findIndex((item) => item.id === transaction.id || item.idempotencyKey === transaction.idempotencyKey);
    if (index === -1) state.creditTransactions.unshift(transaction);
    else state.creditTransactions[index] = { ...state.creditTransactions[index], ...transaction };
  }
  if (wallet?.tenantId) {
    const target = walletForTenant(wallet.tenantId, { create: true });
    Object.assign(target, wallet);
    syncCreditViews(wallet.tenantId);
  }
  return result;
}

async function reserveCreditsTransactional(args) {
  const auth = args.auth || getAuth(args.request);
  const tenantId = requestIdentity(args.request, auth);
  const reservationId = args.reservationId || requestId("reservation");
  const initialCredits = initialCreditsForAuth(auth);
  if (runtimeStore.durable && typeof runtimeStore.reserveCredits === "function") {
    const result = await runtimeStore.reserveCredits({
      reservationId,
      tenantId,
      userId: auth.userId || null,
      amount: args.amount,
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      jobId: args.metadata?.jobId || null,
      metadata: args.metadata || {},
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return reserveCredits({ ...args, initialCredits });
}

async function resolveReservationTransactional(args) {
  if (runtimeStore.durable && typeof runtimeStore.resolveReservation === "function") {
    const result = await runtimeStore.resolveReservation(args);
    return mirrorLedgerResult(result);
  }
  return resolveReservation(args);
}

async function grantCreditsTransactional({ tenantId, userId = null, amount, idempotencyKey, reason = "credit_grant", metadata = {}, initialCredits = 0 } = {}) {
  if (runtimeStore.durable && typeof runtimeStore.grantCredits === "function") {
    const result = await runtimeStore.grantCredits({
      tenantId,
      userId,
      amount,
      idempotencyKey,
      type: reason,
      metadata,
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return grantCredits({ amount, idempotencyKey, reason, metadata, tenantId });
}

async function adjustAvailableCreditsTransactional({ tenantId, userId = null, targetAmount, idempotencyKey, reason = "plan_credit_adjustment", metadata = {}, initialCredits = 0 } = {}) {
  if (runtimeStore.durable && typeof runtimeStore.adjustAvailableCredits === "function") {
    const result = await runtimeStore.adjustAvailableCredits({
      tenantId,
      userId,
      targetAmount,
      idempotencyKey,
      type: reason,
      metadata,
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return adjustAvailableCredits({ targetAmount, idempotencyKey, reason, metadata, tenantId });
}

export {
  creditAccount,
  walletForTenant,
  ledgerSnapshot,
  syncCreditViews,
  findCreditTransactionByIdempotency,
  appendCreditTransaction,
  grantCredits,
  adjustAvailableCredits,
  findCreditReservation,
  reserveCredits,
  resolveReservation,
  initialCreditsForAuth,
  mirrorLedgerResult,
  reserveCreditsTransactional,
  resolveReservationTransactional,
  grantCreditsTransactional,
  adjustAvailableCreditsTransactional
};
