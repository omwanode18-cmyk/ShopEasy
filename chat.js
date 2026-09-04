/**
 * chat.js  —  AI-powered chat widget for ShopEasy
 *
 * Intent understanding:  POST /api/ai-understand  (Gemini 2.5 Flash on the backend)
 * Actions / rules:       All enforced here in the frontend state machine — Gemini
 *                        is ONLY used to classify what the user meant, nothing more.
 *
 * Depends on:  audit.js (logAuditEvent), app.js (products, addToCart, updateCartUI)
 * Payment:     Razorpay Checkout.js (loaded in index.html)
 */

// ── Guardrail ─────────────────────────────────────────────────
// Max cart total the AI chatbot can build automatically.
// Manual "Add to Cart" clicks on the product page are NOT affected.
const AI_CART_LIMIT = 5500;

// ── Conversation state machine ────────────────────────────────
// IDLE | ASKED_CHECKOUT | CONFIRMING_SAVED_DETAILS
// COLLECTING_NAME | COLLECTING_ADDRESS | COLLECTING_PHONE | COLLECTING_EMAIL
// AWAITING_PAYMENT_CONFIRM | PAYMENT_IN_PROGRESS
let chatState = 'IDLE';
let lastMentionedProduct = null;
let greetingShown = false;

// Details collected during chat checkout
let checkoutData = { name: '', address: '', phone: '', email: '' };

// ── Saved details (localStorage) ──────────────────────────────
const SAVED_DETAILS_KEY = 'shopeasy_saved_details';

function _loadSavedDetails() {
  try {
    const raw = localStorage.getItem(SAVED_DETAILS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.name && d.address && d.phone && d.email) return d;
    return null;
  } catch (_) { return null; }
}

function _saveDetails(d) {
  try {
    localStorage.setItem(SAVED_DETAILS_KEY, JSON.stringify({
      name: d.name, address: d.address, phone: d.phone, email: d.email,
    }));
  } catch (_) { }
}

// ── Greeting ──────────────────────────────────────────────────
const GREETING = "Hi! I'm your ShopEasy AI assistant. I can help you find items, book flights, add items to your cart, and even complete checkout — just ask me!";

// ═════════════════════════════════════════════════════════════
//  WIDGET TOGGLE
// ═════════════════════════════════════════════════════════════

function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const btn = document.getElementById('chat-toggle-btn');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    btn.textContent = '✕';
    btn.classList.add('active');
    if (!greetingShown) { appendBotMessage(GREETING); greetingShown = true; }
    setTimeout(() => document.getElementById('chat-input').focus(), 150);
  } else {
    btn.textContent = '💬';
    btn.classList.remove('active');
  }
}

// ═════════════════════════════════════════════════════════════
//  MESSAGE RENDERING
// ═════════════════════════════════════════════════════════════

function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg--user';
  el.textContent = text;
  _appendAndScroll(el);
}

function appendBotMessage(html) {
  const typing = document.createElement('div');
  typing.className = 'chat-msg chat-msg--bot chat-typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  _appendAndScroll(typing);
  setTimeout(() => {
    typing.remove();
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg--bot';
    el.innerHTML = html;
    _appendAndScroll(el);
  }, 500);
}

function _appendAndScroll(el) {
  const c = document.getElementById('chat-messages');
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

// ═════════════════════════════════════════════════════════════
//  SEND MESSAGE  (async — waits for AI understanding)
// ═════════════════════════════════════════════════════════════

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const btn = document.querySelector('.chat-send-btn');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.disabled = true;
  if (btn) btn.disabled = true;

  appendUserMessage(text);

  // Show a persistent typing indicator while waiting for Gemini (may take several seconds)
  const typingBubble = document.createElement('div');
  typingBubble.className = 'chat-msg chat-msg--bot chat-typing';
  typingBubble.id = 'chat-waiting-indicator';
  typingBubble.innerHTML = '<span></span><span></span><span></span>';
  _appendAndScroll(typingBubble);

  try {
    const reply = await _getBotReply(text);
    typingBubble.remove();
    if (reply !== null) appendBotMessage(reply);
  } catch (_) {
    typingBubble.remove();
  } finally {
    input.disabled = false;
    if (btn) btn.disabled = false;
    input.focus();
  }
}

// ═════════════════════════════════════════════════════════════
//  AI UNDERSTANDING  —  calls the backend Gemini endpoint
// ═════════════════════════════════════════════════════════════

async function _getAIUnderstanding(message) {
  try {
    const res = await fetch('/api/ai-understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context: {
          state: chatState,
          today: new Date().toISOString().split('T')[0],   // for "tomorrow" date resolution
          lastMentionedProduct: lastMentionedProduct
            ? { id: lastMentionedProduct.id, name: lastMentionedProduct.name, price: lastMentionedProduct.price }
            : null,
        },
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.intent) throw new Error('No intent in response');
    return { intent: data.intent, extracted: data.extracted || {} };
  } catch (err) {
    console.warn('[chat] AI understanding failed:', err.message);
    return { intent: 'api_error', extracted: {} };
  }
}

// Flight results shown in chat (set by flight_search handler, read by SHOWING_FLIGHT_RESULTS)
let lastFlightResults = [];

// Upsell product pending AI confirmation (set when chatbot adds a product with a cross-sell)
let pendingUpsellProduct = null;

// ═════════════════════════════════════════════════════════════
//  CART HELPERS
// ═════════════════════════════════════════════════════════════

function _getChatCart() {
  try { return JSON.parse(localStorage.getItem('shopeasy_cart') || '[]'); }
  catch (_) { return []; }
}

function _getCurrentCartTotal() {
  return _getChatCart().reduce((s, i) => s + i.price * i.qty, 0);
}

function _clearCart() {
  localStorage.removeItem('shopeasy_cart');
  if (typeof updateCartUI === 'function') updateCartUI();
}

// ── Flight helpers ─────────────────────────────────────────────

function _searchFlights(fromCity, toCity, date, preference) {
  if (typeof flightData === 'undefined') return [];
  const from = (fromCity || '').toLowerCase();
  const to = (toCity || '').toLowerCase();
  let results = flightData.filter(f => {
    const fromOk = !from || f.from.toLowerCase().includes(from) || from.includes(f.from.toLowerCase());
    const toOk = !to || f.to.toLowerCase().includes(to) || to.includes(f.to.toLowerCase());
    const dateOk = !date || f.date === date;
    return fromOk && toOk && dateOk;
  });
  if (preference === 'fastest') results.sort((a, b) => a.durationMins - b.durationMins);
  else results.sort((a, b) => a.price - b.price);   // cheapest or default
  return results;
}

function _addFlightToCart(flight) {
  const cartKey = 'flight-' + flight.id;
  const label = flight.airline + ' ' + flight.flightNo +
    ' (' + flight.from + ' → ' + flight.to + ', ' + flight.date + ')';
  const existing = _getChatCart();
  const alreadyIn = existing.find(i => i.id === cartKey);
  if (alreadyIn) return false;   // already in cart

  // Write flat format to localStorage (same format saveCart/loadCart use)
  const updated = [...existing, { id: cartKey, name: label, price: flight.price, emoji: '✈️', qty: 1 }];
  localStorage.setItem('shopeasy_cart', JSON.stringify(updated));

  // ALSO update the in-memory `cart` global that updateCartUI() reads from.
  // Without this, the badge count stays stale because updateCartUI() never
  // sees the localStorage change — it only reads Object.values(cart).
  if (typeof cart !== 'undefined') {
    cart[cartKey] = {
      product: { id: cartKey, name: label, price: flight.price, emoji: '✈️' },
      qty: 1,
    };
  }

  if (typeof updateCartUI === 'function') updateCartUI();
  return true;
}

// ── Format date helper ─────────────────────────────────────────

function _fmtFlightDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) { return dateStr; }
}

// ═════════════════════════════════════════════════════════════
//  ORDER SUMMARY HTML
// ═════════════════════════════════════════════════════════════

function _buildOrderSummaryHtml() {
  const items = _getChatCart();
  if (items.length === 0) {
    chatState = 'IDLE';
    checkoutData = { name: '', address: '', phone: '', email: '' };
    return 'Hmm, your cart is empty! Add some products first and then say "checkout".';
  }
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const itemsHtml = items
    .map(i => '• ' + i.emoji + ' <strong>' + i.name + '</strong> ×' + i.qty + ' — ₹' + (i.price * i.qty).toFixed(2))
    .join('<br/>');
  return (
    '<strong>Here\'s your order summary:</strong><br/><br/>' +
    itemsHtml + '<br/>' +
    '<strong>Total: ₹' + total.toFixed(2) + '</strong><br/><br/>' +
    '👤 <strong>Name:</strong> ' + _esc(checkoutData.name) + '<br/>' +
    '📍 <strong>Address:</strong> ' + _esc(checkoutData.address) + '<br/>' +
    '📞 <strong>Phone:</strong> ' + _esc(checkoutData.phone) + '<br/>' +
    '📧 <strong>Email:</strong> ' + _esc(checkoutData.email) + '<br/><br/>' +
    'Should I go ahead and charge <strong>₹' + total.toFixed(2) + '</strong> now?<br/>' +
    'Reply <strong>\'Pay by AI\'</strong> to confirm, or <strong>\'cancel\'</strong> to stop.'
  );
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═════════════════════════════════════════════════════════════
//  RAZORPAY PAYMENT
// ═════════════════════════════════════════════════════════════

async function _initiateChatPayment() {
  const items = _getChatCart();
  if (items.length === 0) {
    appendBotMessage('Your cart is empty — nothing to pay for. Add products first!');
    chatState = 'IDLE';
    return;
  }
  if (typeof Razorpay === 'undefined') {
    appendBotMessage(
      'Payment popup could not load (Razorpay script missing).<br/>' +
      'Please go to the <a href="checkout.html" style="color:#e94560;">Checkout page</a> to pay.'
    );
    chatState = 'IDLE';
    return;
  }

  const totalINR = items.reduce((s, i) => s + i.price * i.qty, 0);
  const amountPaise = Math.round(totalINR * 100);

  logAuditEvent('AI_CHECKOUT_STARTED', 'AI chat checkout initiated. Cart total: ₹' + totalINR.toFixed(2), totalINR);

  // Create Razorpay order on backend
  let orderId, orderAmount, orderCurrency;
  try {
    const res = await fetch('/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise }),
    });
    if (!res.ok) throw new Error('Server returned ' + res.status);
    ({ orderId, amount: orderAmount, currency: orderCurrency } = await res.json());
  } catch (err) {
    appendBotMessage(
      'Could not reach the payment server. Please ensure it is running, or go to the ' +
      '<a href="checkout.html" style="color:#e94560;">Checkout page</a>.'
    );
    chatState = 'IDLE';
    return;
  }

  const options = {
    key: 'rzp_test_TVEWNNCcvhMh9q',
    amount: orderAmount, currency: orderCurrency,
    name: 'ShopEasy', description: 'AI Chat Checkout',
    order_id: orderId,
    prefill: { name: checkoutData.name, email: checkoutData.email, contact: checkoutData.phone },
    theme: { color: '#e94560' },
    modal: {
      ondismiss: () => {
        appendBotMessage(
          'Payment popup closed. Your cart is still saved.<br/>' +
          'Say <strong>\'Pay by AI\'</strong> to reopen, or <strong>\'cancel\'</strong> to stop.'
        );
        chatState = 'AWAITING_PAYMENT_CONFIRM';
      },
    },
    handler: async function (response) {
      try {
        const verifyRes = await fetch('/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            amount: totalINR,
          }),
        });
        const { valid } = await verifyRes.json();
        if (valid) {
          localStorage.setItem('shopeasy_last_order', JSON.stringify({
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            items, total: totalINR, name: checkoutData.name,
          }));
          _clearCart();
          // PAYMENT_SUCCESS is logged server-side inside /verify-payment — do NOT log again here
          appendBotMessage(
            '✅ <strong>Payment successful!</strong><br/>' +
            'Payment ID: <code style="font-size:0.78rem;">' + response.razorpay_payment_id + '</code><br/><br/>' +
            'Thank you for your purchase! 🎉<br/>' +
            '<a href="order-success.html" style="color:#e94560;font-weight:600;">View Order Confirmation →</a>'
          );
          chatState = 'IDLE';
          checkoutData = { name: '', address: '', phone: '', email: '' };
        } else {
          appendBotMessage('Payment verification failed. Please contact support.');
          logAuditEvent('PAYMENT_FAILED', 'AI chat payment signature verification failed.', totalINR);
          chatState = 'IDLE';
        }
      } catch (err) {
        appendBotMessage('A verification error occurred. Please contact support.');
        chatState = 'IDLE';
      }
    },
  };

  const rzp = new Razorpay(options);

  // Guard: Razorpay can sometimes fire payment.failed more than once for the
  // same event. This flag ensures only ONE audit log entry per order failure.
  let failureLogged = false;

  rzp.on('payment.failed', function (response) {
    const code = response.error?.code || '';
    const desc = response.error?.description || 'No details provided.';
    const reason = response.error?.reason || '';
    const msg = [desc, reason].filter(Boolean).join(' · ');
    appendBotMessage(
      '❌ <strong>Payment failed — no charge was made.</strong><br/>' + msg + '<br/><br/>' +
      'Say <strong>\'Pay by AI\'</strong> to try again, or <strong>\'cancel\'</strong> to stop.'
    );
    // ── AUDIT: log once per order failure ─────────────────────────
    if (!failureLogged) {
      failureLogged = true;
      logAuditEvent(
        'PAYMENT_FAILED',
        'AI chat payment failed — ' + msg + (code ? ' | Code: ' + code : '') + ' | Order ID: ' + orderId,
        totalINR
      );
    }
    chatState = 'AWAITING_PAYMENT_CONFIRM';
  });
  rzp.open();
}

// ═════════════════════════════════════════════════════════════
//  MAIN REPLY ENGINE  (async — uses Gemini for intent)
// ═════════════════════════════════════════════════════════════

async function _getBotReply(msg) {
  const norm = msg.toLowerCase().trim();

  // ── 1. Universal cancel — always pattern-matched, no AI needed ─
  if (chatState !== 'IDLE') {
    const cancelWords = ['cancel', 'stop', 'quit', 'exit', 'abort', 'never mind', 'nevermind'];
    if (cancelWords.some(w => norm === w || norm.startsWith(w + ' '))) {
      chatState = 'IDLE';
      checkoutData = { name: '', address: '', phone: '', email: '' };
      lastMentionedProduct = null;
      lastFlightResults    = [];
      pendingUpsellProduct = null;
      return 'No problem, your cart is saved. Let me know if you\'d like to continue shopping or checkout later. 🛍';
    }
  }

  // ── 2. Raw-text collection states — skip AI, use message directly ─
  //    These states treat ANY non-cancel input as the requested detail.

  if (chatState === 'COLLECTING_NAME') {
    checkoutData.name = msg.trim();
    chatState = 'COLLECTING_ADDRESS';
    return 'Got it, ' + _esc(checkoutData.name) + '! 👋<br/>What\'s your <strong>delivery address</strong>?';
  }

  if (chatState === 'COLLECTING_ADDRESS') {
    checkoutData.address = msg.trim();
    chatState = 'COLLECTING_PHONE';
    return 'Address saved. 📍<br/>What\'s your <strong>phone number</strong>?';
  }

  if (chatState === 'COLLECTING_PHONE') {
    checkoutData.phone = msg.trim();
    chatState = 'COLLECTING_EMAIL';
    return 'Almost there! Last one — what\'s your <strong>email address</strong>?';
  }

  if (chatState === 'COLLECTING_EMAIL') {
    checkoutData.email = msg.trim();
    chatState = 'AWAITING_PAYMENT_CONFIRM';
    _saveDetails(checkoutData);
    logAuditEvent('AI_CHECKOUT_DETAILS_COLLECTED', 'AI chat collected all checkout details for: ' + checkoutData.name, null);
    return _buildOrderSummaryHtml();
  }

  if (chatState === 'PAYMENT_IN_PROGRESS') {
    return 'The payment popup is open — please complete the payment there.';
  }

  // ─────────────────────────────────────────────────────────────────
  //  STATE: SHOWING_FLIGHT_RESULTS — user picks one of up to 3 flights
  //  Uses local pattern matching (no AI call needed for 1/2/3 selection)
  // ─────────────────────────────────────────────────────────────────
  if (chatState === 'SHOWING_FLIGHT_RESULTS') {
    // Match by number (1/2/3) or ordinal word or airline/flight number
    const pickMap = [
      { keys: ['1', 'one', 'first', 'option 1', '1st', 'first one'], idx: 0 },
      { keys: ['2', 'two', 'second', 'option 2', '2nd', 'second one'], idx: 1 },
      { keys: ['3', 'three', 'third', 'option 3', '3rd', 'third one'], idx: 2 },
    ];

    let selected = null;
    for (const { keys, idx } of pickMap) {
      if (keys.some(k => norm === k || norm.startsWith(k + ' ') || norm.endsWith(' ' + k))) {
        selected = lastFlightResults[idx] || null;
        break;
      }
    }
    // Also match by airline name or flight number in message
    if (!selected) {
      selected = lastFlightResults.find(f =>
        norm.includes(f.airline.toLowerCase()) || norm.includes(f.flightNo.toLowerCase())
      ) || null;
    }

    if (selected) {
      const currentTotal = _getCurrentCartTotal();
      const projectedTotal = currentTotal + selected.price;

      if (projectedTotal > AI_CART_LIMIT) {
        chatState = 'IDLE';
        lastFlightResults = [];
        logAuditEvent(
          'AI_BLOCKED_LIMIT',
          'Blocked flight add — projected cart ₹' + projectedTotal.toFixed(2) +
          ' exceeds ₹' + AI_CART_LIMIT + ' limit',
          projectedTotal
        );
        return (
          '⚠️ Adding <strong>' + selected.airline + ' ' + selected.flightNo +
          '</strong> (₹' + selected.price.toLocaleString() + ') would bring your cart to ' +
          '<strong>₹' + projectedTotal.toFixed(2) + '</strong>, over the ' +
          '<strong>₹' + AI_CART_LIMIT + ' auto-approval limit</strong>.<br/><br/>' +
          'Visit <a href="flights.html" style="color:#e14868;">Book a Flight</a> to add it manually.'
        );
      }

      const added = _addFlightToCart(selected);
      const cartTotal = (currentTotal + selected.price).toFixed(2);
      lastFlightResults = [];
      chatState = 'ASKED_CHECKOUT';

      if (!added) {
        return 'That flight is already in your cart! Would you like to <strong>check out now</strong>?';
      }

      logAuditEvent(
        'AI_ADD_TO_CART',
        'AI added flight ' + selected.flightNo + ' (' + selected.from + '→' + selected.to +
        ') at ₹' + selected.price + ' (cart now ₹' + cartTotal + ')',
        selected.price
      );
      return (
        'Done! ✈️ <strong>' + selected.airline + ' ' + selected.flightNo + '</strong> added to your cart.<br/><br/>' +
        'Would you like to <strong>check out now</strong>, or keep shopping?'
      );
    }

    return (
      'Please say <strong>"1"</strong>, <strong>"2"</strong>, or <strong>"3"</strong> to pick a flight, ' +
      'or <strong>"cancel"</strong> to go back.'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  //  STATE: UPSELL_PENDING — waiting for user to accept/decline cross-sell
  //  Uses local pattern matching (no AI call needed for yes/no)
  // ─────────────────────────────────────────────────────────────────
  if (chatState === 'UPSELL_PENDING') {
    const yesWords = ['yes', 'yeah', 'sure', 'ok', 'okay', 'add', 'add it', 'add that',
                      'do it', 'yep', 'please', 'go ahead', 'sounds good'];
    const noWords  = ['no', 'nope', 'no thanks', 'not now', 'skip', 'nah', 'later',
                      'dont', "don't", 'ignore', 'pass', 'decline'];

    const isYes = yesWords.some(w => norm === w || norm.startsWith(w + ' ') || norm.endsWith(' ' + w));
    const isNo  = noWords.some(w  => norm === w || norm.startsWith(w + ' ') || norm.endsWith(' ' + w));

    if (isYes && pendingUpsellProduct) {
      const p = pendingUpsellProduct;
      pendingUpsellProduct = null;

      const currentTotal   = _getCurrentCartTotal();
      const projectedTotal = currentTotal + p.price;

      if (projectedTotal > AI_CART_LIMIT) {
        chatState = 'IDLE';
        logAuditEvent(
          'AI_BLOCKED_LIMIT',
          'Blocked upsell add of "' + p.name + '" — projected ₹' + projectedTotal.toFixed(2) +
          ' exceeds ₹' + AI_CART_LIMIT + ' limit', projectedTotal
        );
        return (
          '⚠️ Adding <strong>' + p.name + '</strong> would bring your cart to ' +
          '<strong>₹' + projectedTotal.toFixed(2) + '</strong>, over the ' +
          '<strong>₹' + AI_CART_LIMIT + ' auto-approval limit</strong>.<br/><br/>' +
          'You can add it manually from the <a href="index.html" style="color:#e14868;font-weight:600;">product page</a>.'
        );
      }

      addToCart(p.id, true);   // true = suppress manual upsell popup (chatbot handles it)
      logAuditEvent('UPSELL_ACCEPTED', 'Upsell accepted (AI chat): "' + p.name + '" added', p.price);
      chatState = 'ASKED_CHECKOUT';
      return (
        '✅ <strong>' + p.name + '</strong> ' + p.emoji + ' added too! 🛒<br/><br/>' +
        'Would you like to <strong>check out now</strong>, or keep shopping?'
      );
    }

    if (isNo) {
      pendingUpsellProduct = null;
      chatState = 'ASKED_CHECKOUT';
      return 'No problem! Would you like to <strong>check out now</strong>, or keep shopping? 🛍';
    }

    // Unclear — re-prompt once
    const pName = pendingUpsellProduct ? pendingUpsellProduct.name : 'it';
    return (
      'Just to confirm — want me to add <strong>' + pName + '</strong> to your cart? ' +
      'Reply <strong>"yes"</strong> or <strong>"no"</strong>.'
    );
  }

  // ── 3. All other states use Gemini to classify intent ────────────
  const understanding = await _getAIUnderstanding(msg);

  if (understanding.intent === 'api_error') {
    return 'Sorry, I\'m having trouble understanding right now — could you rephrase that?';
  }

  const { intent, extracted } = understanding;

  // ─────────────────────────────────────────────────────────────────
  //  STATE: ASKED_CHECKOUT
  // ─────────────────────────────────────────────────────────────────
  if (chatState === 'ASKED_CHECKOUT') {
    if (intent === 'checkout_start' || intent === 'confirm_add') {
      logAuditEvent('AI_CHECKOUT_DETAILS_STARTED', 'User started AI-guided checkout via chat.');
      const saved = _loadSavedDetails();
      if (saved) {
        checkoutData = { ...saved };
        chatState = 'CONFIRMING_SAVED_DETAILS';
        return (
          'I have your saved details:<br/><br/>' +
          '👤 <strong>Name:</strong> ' + _esc(saved.name) + '<br/>' +
          '📍 <strong>Address:</strong> ' + _esc(saved.address) + '<br/>' +
          '📞 <strong>Phone:</strong> ' + _esc(saved.phone) + '<br/>' +
          '📧 <strong>Email:</strong> ' + _esc(saved.email) + '<br/><br/>' +
          'Use these, or would you like to update any of them?<br/>' +
          'Reply <strong>\'use these\'</strong> to continue, or <strong>\'update\'</strong> to enter new details.'
        );
      }
      chatState = 'COLLECTING_NAME';
      return 'Let\'s get you checked out! First, what\'s your <strong>full name</strong>?';
    }
    // Anything else = keep shopping
    chatState = 'IDLE';
    return 'No problem! Keep browsing. Say <strong>"checkout"</strong> anytime you\'re ready to pay. 🛍';
  }

  // ─────────────────────────────────────────────────────────────────
  //  STATE: CONFIRMING_SAVED_DETAILS
  // ─────────────────────────────────────────────────────────────────
  if (chatState === 'CONFIRMING_SAVED_DETAILS') {
    if (intent === 'use_saved_details') {
      chatState = 'AWAITING_PAYMENT_CONFIRM';
      logAuditEvent('AI_CHECKOUT_DETAILS_COLLECTED', 'User reused saved details for: ' + checkoutData.name, null);
      return _buildOrderSummaryHtml();
    }
    if (intent === 'update_details') {
      chatState = 'COLLECTING_NAME';
      return 'No problem! Let\'s start fresh.<br/><br/>What\'s your <strong>full name</strong>?';
    }
    return (
      'Please reply <strong>\'use these\'</strong> to proceed with your saved details, ' +
      'or <strong>\'update\'</strong> to enter new ones.'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  //  STATE: AWAITING_PAYMENT_CONFIRM
  //  STRICT: only pay_confirm intent from Gemini triggers payment
  // ─────────────────────────────────────────────────────────────────
  if (chatState === 'AWAITING_PAYMENT_CONFIRM') {
    if (intent === 'pay_confirm') {
      chatState = 'PAYMENT_IN_PROGRESS';
      logAuditEvent('AI_PAYMENT_CONFIRM_RECEIVED', '"Pay by AI" confirmation received from user.');
      setTimeout(() => _initiateChatPayment(), 600);
      return '💳 Opening the Razorpay payment popup…<br/><small style="color:#888;">Complete the payment in the popup that appears.</small>';
    }
    return (
      'Please reply <strong>\'Pay by AI\'</strong> to confirm and open the payment popup, ' +
      'or <strong>\'cancel\'</strong> to stop.'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  //  STATE: IDLE  —  route by AI intent
  // ─────────────────────────────────────────────────────────────────

  // "yes" / "add it" after product mention
  if (intent === 'confirm_add' && lastMentionedProduct) {
    const p = lastMentionedProduct;
    lastMentionedProduct = null;

    const currentTotal = _getCurrentCartTotal();
    const projectedTotal = currentTotal + p.price;

    if (projectedTotal > AI_CART_LIMIT) {
      logAuditEvent(
        'AI_BLOCKED_LIMIT',
        'Blocked AI add of "' + p.name + '" (₹' + p.price.toFixed(2) +
        ') — projected cart total ₹' + projectedTotal.toFixed(2) +
        ' exceeds ₹' + AI_CART_LIMIT + ' limit',
        projectedTotal
      );
      return (
        '⚠️ Adding <strong>' + p.name + '</strong> would bring your cart to ' +
        '<strong>₹' + projectedTotal.toFixed(2) + '</strong>, which is over the ' +
        '<strong>₹' + AI_CART_LIMIT + ' auto-approval limit</strong>.<br/><br/>' +
        'To proceed, please add it manually from the ' +
        '<a href="index.html" style="color:#e94560;font-weight:600;">product page</a>.'
      );
    }

    addToCart(p.id, true);   // true = suppress manual upsell popup (chatbot handles it)
    logAuditEvent(
      'AI_ADD_TO_CART',
      'AI added "' + p.name + '" to cart at ₹' + p.price.toFixed(2) +
      ' (cart now ₹' + projectedTotal.toFixed(2) + ')',
      p.price
    );

    // Cross-sell: check if this product has a companion suggestion
    const upsellId      = typeof UPSELL_MAP !== 'undefined' ? UPSELL_MAP[p.id] : null;
    const upsellProduct = upsellId ? products.find(pr => pr.id === upsellId) : null;
    // Skip upsell if the suggested item is already in the cart
    const alreadyHaveIt = upsellId && _getChatCart().some(i => i.id === upsellId);

    if (upsellProduct && !alreadyHaveIt) {
      pendingUpsellProduct = upsellProduct;
      chatState = 'UPSELL_PENDING';
      logAuditEvent(
        'UPSELL_SUGGESTED',
        'Upsell suggested (AI chat): "' + upsellProduct.name + '" after adding "' + p.name + '"',
        upsellProduct.price
      );
      return (
        'Done! <strong>' + p.name + '</strong> added to your cart. 🛒<br/><br/>' +
        'By the way, customers who buy this often also get <strong>' + upsellProduct.name + '</strong> ' +
        upsellProduct.emoji + ' (₹' + upsellProduct.price.toFixed(2) + ') — want me to add that too?'
      );
    }

    chatState = 'ASKED_CHECKOUT';
    return (
      'Done! <strong>' + p.name + '</strong> added to your cart. 🛒<br/><br/>' +
      'Would you like to <strong>check out now</strong>, or keep shopping?'
    );
  }

  // Price filter
  if (intent === 'price_filter') {
    const limit = extracted.priceLimit;
    if (!limit || isNaN(limit)) {
      return 'What price range are you looking for? (e.g. "under ₹40")';
    }
    const matches = products.filter(p => p.price <= limit);
    lastMentionedProduct = null;
    if (matches.length === 0) {
      return 'Sorry, I don\'t have any products priced at ₹' + limit + ' or under right now. 😔';
    }
    const list = matches
      .map(p => p.emoji + ' <strong>' + p.name + '</strong> — ₹' + p.price.toFixed(2))
      .join('<br/>');
    return 'Here are products under ₹' + limit + ':<br/><br/>' + list;
  }

  // Product lookup (Gemini matches even with typos via productId)
  if (intent === 'product_lookup') {
    const pid = extracted.productId;
    const found = pid ? products.find(p => p.id === pid) : null;
    if (found) {
      lastMentionedProduct = found;
      logAuditEvent(
        'AI_PRODUCT_LOOKUP',
        'AI showed product info: "' + found.name + '" at ₹' + found.price.toFixed(2),
        found.price
      );
      return (
        'I found <strong>' + found.name + '</strong> ' + found.emoji +
        ' for <strong>₹' + found.price.toFixed(2) + '</strong>.<br/><br/>' +
        'Would you like me to add it to your cart?'
      );
    }
    return 'Hmm, I couldn\'t find that product. Try asking for "headphones", "keyboard", "mouse", etc.';
  }

  // Checkout from IDLE (cart already has items)
  if (intent === 'checkout_start') {
    const cartItems = _getChatCart();
    if (cartItems.length === 0) {
      return 'Your cart is empty! Add some products first and then say "checkout". 🛍';
    }
    logAuditEvent('AI_CHECKOUT_DETAILS_STARTED', 'User initiated AI checkout from IDLE state.');
    const saved = _loadSavedDetails();
    if (saved) {
      checkoutData = { ...saved };
      chatState = 'CONFIRMING_SAVED_DETAILS';
      return (
        'I have your saved details:<br/><br/>' +
        '👤 <strong>Name:</strong> ' + _esc(saved.name) + '<br/>' +
        '📍 <strong>Address:</strong> ' + _esc(saved.address) + '<br/>' +
        '📞 <strong>Phone:</strong> ' + _esc(saved.phone) + '<br/>' +
        '📧 <strong>Email:</strong> ' + _esc(saved.email) + '<br/><br/>' +
        'Use these, or would you like to update?<br/>' +
        'Reply <strong>\'use these\'</strong> or <strong>\'update\'</strong>.'
      );
    }
    chatState = 'COLLECTING_NAME';
    return 'Let\'s get you checked out! First, what\'s your <strong>full name</strong>?';
  }

  // Cancel from IDLE = nothing to cancel
  if (intent === 'cancel') {
    return 'Nothing to cancel! Browse products or say "checkout" when ready. 🛍';
  }

  // Flight search
  if (intent === 'flight_search') {
    const { fromCity, toCity, flightDate, preference } = extracted;
    if (!fromCity || !toCity) {
      return (
        'Which route are you looking for? Tell me departure and destination, e.g.<br/>' +
        '<em>"flights from Pune to Bangalore"</em><br/>' +
        'Or visit <a href="flights.html" style="color:#e14868;">Book a Flight</a> to search visually.'
      );
    }
    const results = _searchFlights(fromCity, toCity, flightDate, preference || 'default');
    if (results.length === 0) {
      return (
        'No flights found from <strong>' + fromCity + '</strong> to <strong>' + toCity + '</strong>' +
        (flightDate ? ' on ' + _fmtFlightDate(flightDate) : '') + '.<br/>' +
        'Available routes: Pune↔Bangalore, Mumbai↔Delhi, Delhi↔Goa, Chennai↔Hyderabad, Bangalore↔Mumbai.<br/>' +
        'Try <a href="flights.html" style="color:#e14868;">Book a Flight</a> for all options.'
      );
    }

    lastFlightResults = results.slice(0, 3);
    chatState = 'SHOWING_FLIGHT_RESULTS';
    const sortLabel = preference === 'fastest' ? ' ⚡ sorted by fastest' : ' 💰 sorted by price';

    logAuditEvent(
      'AI_FLIGHT_SEARCH',
      'AI searched flights: ' + fromCity + ' → ' + toCity +
      (flightDate ? ' on ' + flightDate : '') + ', pref: ' + (preference || 'default')
    );

    let msg =
      'Here are flights from <strong>' + fromCity + '</strong> to <strong>' + toCity + '</strong>' +
      (flightDate ? ' on ' + _fmtFlightDate(flightDate) : '') + sortLabel + ':<br/><br/>';

    lastFlightResults.forEach((f, i) => {
      msg +=
        '<strong>' + (i + 1) + '.</strong> ' + f.airline + ' <code>' + f.flightNo + '</code><br/>' +
        '&nbsp;&nbsp;' + f.departure + ' → ' + f.arrival + ' &nbsp;(' + f.duration + ')' +
        '&nbsp;&nbsp;<strong style="color:#e14868;">₹' + f.price.toLocaleString() + '</strong><br/><br/>';
    });

    msg += 'Say <strong>"1"</strong>, <strong>"2"</strong>, or <strong>"3"</strong> to add one to your cart.';
    return msg;
  }

  // Help / unclear
  if (intent === 'unclear') {
    return (
      'I\'m not sure what you mean. I can help you:<br/>' +
      '• Find a product (e.g. <em>"headphones"</em> or <em>"keybord"</em>)<br/>' +
      '• Filter by price (e.g. <em>"under ₹50"</em>)<br/>' +
      '• Book a flight (e.g. <em>"flights from Pune to Bangalore"</em>)<br/>' +
      '• Add items and checkout entirely via chat<br/>' +
      'Try rephrasing, or say <strong>"help"</strong>!'
    );
  }

  // Fallback
  return (
    'Sorry, I didn\'t quite get that. 🤔<br/>' +
    'Try asking about a product, say <em>"under ₹40"</em>, or type <em>"checkout"</em>.'
  );
}

// ═════════════════════════════════════════════════════════════
//  FALLBACK KEYWORD PRODUCT MATCH
//  Used only if Gemini returns product_lookup but no productId
// ═════════════════════════════════════════════════════════════

function _findProductInMessage(norm) {
  const aliases = {
    1: ['headphone', 'headset', 'noise cancelling', 'wireless headphone'],
    2: ['keyboard', 'mechanical', 'tkl', 'mech keyboard'],
    3: ['charger', 'usb-c', 'usbc', 'fast charger', '65w'],
    4: ['speaker', 'bluetooth speaker', 'portable speaker', 'bluetooth'],
    5: ['lamp', 'desk lamp', 'led lamp', 'light', 'desk light'],
    6: ['mouse', 'ergonomic mouse', 'wireless mouse'],
  };
  for (const p of products) {
    const nameWords = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const nameMatch = nameWords.some(w => norm.includes(w));
    const aliasMatch = (aliases[p.id] || []).some(a => norm.includes(a));
    if (nameMatch || aliasMatch) return p;
  }
  return null;
}
