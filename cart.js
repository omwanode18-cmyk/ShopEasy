// ── Load cart from localStorage ───────────────────────────────
function getCart() {
  try {
    return JSON.parse(localStorage.getItem("shopeasy_cart") || "[]");
  } catch (_) { return []; }
}

function saveCart(items) {
  localStorage.setItem("shopeasy_cart", JSON.stringify(items));
}

function formatPrice(n) {
  return "₹" + n.toFixed(2);
}

// ── Render Cart ───────────────────────────────────────────────
function renderCart() {
  const items       = getCart();
  const emptyState  = document.getElementById("empty-state");
  const content     = document.getElementById("cart-page-content");
  const list        = document.getElementById("cart-items-list");
  const countBadge  = document.getElementById("cart-count");

  const totalQty   = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.qty, 0);

  // Header badge
  countBadge.textContent = totalQty;

  if (items.length === 0) {
    emptyState.style.display = "flex";
    content.style.display    = "none";
    return;
  }

  emptyState.style.display = "none";
  content.style.display    = "flex";

  // Summary
  document.getElementById("item-count").textContent     = totalQty;
  document.getElementById("subtotal-price").textContent = formatPrice(totalPrice);
  document.getElementById("total-price").textContent    = formatPrice(totalPrice);

  // Item rows
  list.innerHTML = "";
  items.forEach((item) => {
    // String IDs (flights: "flight-F001") need single quotes inside the double-quoted
    // onclick attribute: changeQty('flight-F001', -1).
    // Numeric IDs (products: 1) are passed bare: changeQty(1, -1).
    const idRef = typeof item.id === "string" ? `'${item.id}'` : item.id;
    const row = document.createElement("div");
    row.className = "cart-row";
    row.innerHTML = `
      <div class="cart-row-emoji">${item.emoji}</div>
      <div class="cart-row-details">
        <div class="cart-row-name">${item.name}</div>
        <div class="cart-row-unit-price">${formatPrice(item.price)} each</div>
      </div>
      <div class="cart-row-controls">
        <button class="qty-btn" onclick="changeQty(${idRef}, -1)" aria-label="Decrease">−</button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty(${idRef}, 1)" aria-label="Increase">+</button>
      </div>
      <div class="cart-row-total">${formatPrice(item.price * item.qty)}</div>
      <button class="remove-btn" onclick="removeItem(${idRef})" aria-label="Remove">🗑</button>
    `;
    list.appendChild(row);
  });
}

// ── Quantity Change ───────────────────────────────────────────
function changeQty(id, delta) {
  let items = getCart();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return;

  items[idx].qty += delta;
  if (items[idx].qty <= 0) {
    items.splice(idx, 1);          // remove if qty hits 0
  }

  saveCart(items);
  renderCart();
}

// ── Remove Item ───────────────────────────────────────────────
function removeItem(id) {
  const items = getCart().filter((i) => i.id !== id);
  saveCart(items);
  renderCart();
}

// ── Init ──────────────────────────────────────────────────────
renderCart();

