// ── Cart helpers ──────────────────────────────────────────────
function getCart() {
  try { return JSON.parse(localStorage.getItem("shopeasy_cart") || "[]"); }
  catch (_) { return []; }
}

function formatPrice(n) { return "₹" + n.toFixed(2); }

// ── Render Order Summary (right panel) ────────────────────────
function renderSummary() {
  const items      = getCart();
  const countBadge = document.getElementById("cart-count");
  const emptyState = document.getElementById("empty-state");
  const content    = document.getElementById("order-summary-content");

  const totalQty   = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.qty, 0);

  countBadge.textContent = totalQty;

  if (items.length === 0) {
    emptyState.style.display = "flex";
    content.style.display    = "none";
    document.querySelector(".checkout-form-section").style.display = "none";
    return;
  }

  emptyState.style.display = "none";
  content.style.display    = "block";

  const orderItems = document.getElementById("order-items");
  orderItems.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "order-item-row";
    row.innerHTML = `
      <span class="order-item-emoji">${item.emoji}</span>
      <span class="order-item-name">${item.name}</span>
      <span class="order-item-qty">x${item.qty}</span>
      <span class="order-item-price">${formatPrice(item.price * item.qty)}</span>
    `;
    orderItems.appendChild(row);
  });

  document.getElementById("order-subtotal").textContent = formatPrice(totalPrice);
  document.getElementById("order-total").textContent    = formatPrice(totalPrice);
}

// ── UI helpers ────────────────────────────────────────────────
function setPayBtnState(loading) {
  const btn = document.getElementById("pay-btn");
  btn.disabled    = loading;
  btn.textContent = loading ? "⏳ Processing…" : "💳 Pay Now";
}

function showPaymentError(message, reason) {
  const el = document.getElementById("payment-error");
  el.innerHTML =
    `<span class="perr-icon">❌</span>` +
    `<span class="perr-body">` +
      `<strong>Payment failed — please try again.</strong> Your cart has been saved.<br/>` +
      `<span class="perr-reason">${message}</span>` +
    `</span>` +
    `<button class="perr-dismiss" onclick="this.parentElement.style.display=''none''" aria-label="Dismiss">✕</button>`;
  el.style.display = "flex";
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // No auto-hide — user dismisses it or it clears on the next pay attempt
}

// ── Pay Now — main handler ─────────────────────────────────────
async function handlePayNow(event) {
  event.preventDefault();
  document.getElementById("payment-error").style.display = "none";

  const items = getCart();
  if (items.length === 0) { showPaymentError("Your cart is empty."); return; }

  const name  = document.getElementById("full-name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();

  const totalINR    = items.reduce((s, i) => s + i.price * i.qty, 0);
  const amountPaise = Math.round(totalINR * 100);

  setPayBtnState(true);

  // ── Step 1: Create Razorpay order on backend ──────────────────
  // Note: CHECKOUT_STARTED is logged server-side inside /create-order
  let orderId, orderAmount, orderCurrency;
  try {
    const res = await fetch("/create-order", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ amount: amountPaise }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Server error creating order");
    }
    ({ orderId, amount: orderAmount, currency: orderCurrency } = await res.json());
  } catch (err) {
    console.error(err);
    showPaymentError("Could not connect to payment server. Make sure it is running.");
    setPayBtnState(false);
    return;
  }

  // ── Step 2: Open Razorpay popup ───────────────────────────────
  const options = {
    key:         "rzp_test_TVEWNNCcvhMh9q",
    amount:      orderAmount,
    currency:    orderCurrency,
    name:        "ShopEasy",
    description: "Order Payment",
    order_id:    orderId,
    prefill:     { name, email, contact: phone },
    theme:       { color: "#e94560" },
    modal: {
      ondismiss: () => { setPayBtnState(false); },
    },

    // ── Step 3: Payment success ───────────────────────────────────
    // PAYMENT_SUCCESS is logged server-side inside /verify-payment
    handler: async function (response) {
      try {
        const verifyRes = await fetch("/verify-payment", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            amount:              totalINR,   // passed so server can log it
          }),
        });

        const { valid, error } = await verifyRes.json();

        if (!valid) {
          showPaymentError(error || "Payment verification failed. Please contact support.");
          setPayBtnState(false);
          return;
        }

        // Store order info, clear cart, redirect to success page
        localStorage.setItem("shopeasy_last_order", JSON.stringify({
          paymentId: response.razorpay_payment_id,
          orderId:   response.razorpay_order_id,
          items,
          total:     totalINR,
          name,
        }));
        localStorage.removeItem("shopeasy_cart");
        window.location.href = "order-success.html";

      } catch (err) {
        console.error(err);
        showPaymentError("Verification error. Please contact support.");
        setPayBtnState(false);
      }
    },
  };

  const rzp = new Razorpay(options);

  // Guard: Razorpay can sometimes fire payment.failed more than once for the
  // same event. This flag ensures only ONE audit log entry per order failure.
  let failureLogged = false;

  // ── Step 4: Payment failure ───────────────────────────────────
  rzp.on("payment.failed", function (response) {
    const code   = response.error?.code        || "";
    const desc   = response.error?.description || "No further details provided.";
    const reason = response.error?.reason      || "";

    const displayMsg = [desc, reason].filter(Boolean).join(" · ");

    showPaymentError(displayMsg);

    // ── AUDIT: log once per order failure ─────────────────────────
    if (!failureLogged) {
      failureLogged = true;
      logAuditEvent(
        "PAYMENT_FAILED",
        `Razorpay payment failed — ${displayMsg}${code ? " | Code: " + code : ""} | Order ID: ${orderId}`,
        totalINR
      );
    }

    setPayBtnState(false);
  });

  rzp.open();
  setPayBtnState(false);
}

// ── Init ──────────────────────────────────────────────────────
renderSummary();
