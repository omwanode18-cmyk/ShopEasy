/**
 * audit.js — Frontend audit logging helper.
 * Loaded on pages that generate client-side audit events (index.html, checkout.html).
 * POSTs log entries to the backend; silently no-ops if the server is unreachable.
 */

function logAuditEvent(actionType, description, amount) {
  fetch("/api/log", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      actionType,
      description,
      amount: (amount !== undefined && amount !== null) ? Number(amount) : null,
    }),
  }).catch(() => {}); // fail silently — never break the UI
}
