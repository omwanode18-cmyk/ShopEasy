// ── Product Data ──────────────────────────────────────────────
const products = [
  { id: 1, name: "Wireless Noise-Cancelling Headphones", price: 79.99, emoji: "🎧", rating: 4.5, badge: "New"  },
  { id: 2, name: "Mechanical Keyboard (TKL)",            price: 54.99, emoji: "⌨️", rating: 4.3, badge: null   },
  { id: 3, name: "USB-C Fast Charger 65W",               price: 19.99, emoji: "🔌", rating: 4.7, badge: "Sale" },
  { id: 4, name: "Portable Bluetooth Speaker",           price: 39.99, emoji: "🔊", rating: 4.2, badge: null   },
  { id: 5, name: "Smart LED Desk Lamp",                  price: 34.99, emoji: "💡", rating: 4.6, badge: "New"  },
  { id: 6, name: "Ergonomic Mouse (Wireless)",           price: 44.99, emoji: "🖱️", rating: 4.4, badge: null   },
];

// ── Cart State (backed by localStorage) ──────────────────────
// Format: { [id]: { product: {...}, qty: Number } }
const cart = {};

function loadCart() {
  try {
    const saved = localStorage.getItem("shopeasy_cart");
    if (!saved) return;
    JSON.parse(saved).forEach((item) => {
      cart[item.id] = {
        product: { id: item.id, name: item.name, price: item.price, emoji: item.emoji },
        qty: item.qty,
      };
    });
  } catch (_) {}
}

function saveCart() {
  const items = Object.values(cart).map(({ product, qty }) => ({
    id: product.id, name: product.name, price: product.price, emoji: product.emoji, qty,
  }));
  localStorage.setItem("shopeasy_cart", JSON.stringify(items));
}

// ── Helpers ───────────────────────────────────────────────────
function starsFor(rating) {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const filled = '<span class="text-[#e14868]">★</span>';
  const grey   = '<span class="text-gray-300">★</span>';
  return filled.repeat(full) + (half ? filled : '') + grey.repeat(empty);
}

function formatPrice(price) {
  return "₹" + price.toFixed(2);
}

// ── Render Products (Tailwind card design) ────────────────────
function renderProducts() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;
  grid.innerHTML = "";

  products.forEach((p) => {
    const badge = p.badge
      ? `<span class="absolute top-3 right-3 bg-[#e14868] text-white text-[11px]
                      font-bold px-2.5 py-0.5 rounded-full shadow">${p.badge}</span>`
      : "";

    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-xl transition-shadow duration-300 flex flex-col";
    card.dataset.productId = p.id;   // used by _showUpsellPopup to target this card
    card.innerHTML = `
      <!-- Product image area -->
      <div class="relative bg-gradient-to-br from-gray-100 to-gray-200 h-48 flex items-center justify-center flex-shrink-0">
        <span class="text-7xl select-none">${p.emoji}</span>
        ${badge}
      </div>

      <!-- Card body -->
      <div class="p-4 flex flex-col flex-1">
        <h3 class="font-bold text-[#1a1a2e] text-sm leading-snug mb-2 flex-1">${p.name}</h3>

        <div class="flex items-center gap-1 mb-2 text-sm">
          ${starsFor(p.rating)}
          <span class="text-gray-400 text-xs ml-1">(${p.rating})</span>
        </div>

        <p class="text-[#e14868] font-extrabold text-2xl mb-3">${formatPrice(p.price)}</p>

        <button onclick="addToCart(${p.id})"
                class="w-full bg-[#1a1a2e] hover:bg-[#2d2d4e] text-white text-sm font-semibold
                       py-2.5 rounded-lg transition-colors duration-200 mt-auto">
          Add to Cart
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── Cross-sell map ────────────────────────────────────────────
// Maps each product id to the best companion product id.
// One-directional only — no A→B + B→A back-and-forth pairs.
// Used by both manual "Add to Cart" (popup) and the AI chatbot.
const UPSELL_MAP = {
  1: 4,  // Wireless Headphones  → Bluetooth Speaker   (audio pair)
  2: 6,  // Mechanical Keyboard  → Ergonomic Mouse     (desk setup)
  3: 5,  // USB-C Fast Charger   → Smart LED Desk Lamp (desk essentials)
  4: 3,  // Bluetooth Speaker    → USB-C Fast Charger  (keep it powered)
  5: 6,  // Smart LED Desk Lamp  → Ergonomic Mouse     (complete the desk)
  6: 1,  // Ergonomic Mouse      → Wireless Headphones (full workstation)
};

// ── Cart Logic ────────────────────────────────────────────────
let _isUpsellAdd    = false;  // prevents a chain upsell when upsell item is added
let _upsellTimer    = null;
let _upsellTargetId = null;   // id of suggested product, read by _addUpsellToCart()

// _noUpsellPopup = true when called from the AI chatbot — the chatbot handles
// its own upsell suggestion via chat message; the popup must NOT also appear.
function addToCart(id, _noUpsellPopup = false) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  if (cart[id]) {
    cart[id].qty += 1;
  } else {
    cart[id] = { product, qty: 1 };
  }
  saveCart();
  updateCartUI();
  showToast('"' + product.name + '" added to cart');
  if (!_isUpsellAdd && !_noUpsellPopup) _showUpsellPopup(id);
}

// ── Upsell inline suggestion logic ───────────────────────────
// Shows a small suggestion row BELOW the clicked product's "Add to Cart"
// button — no fixed popup. Dismissed automatically after 6 s or on "Add".

function _showUpsellPopup(addedId) {
  const suggestedId = UPSELL_MAP[addedId];
  if (!suggestedId) return;
  const suggested = products.find(p => p.id === suggestedId);
  if (!suggested) return;

  // Skip if the suggested item is already in the cart
  if (cart[suggestedId]) return;

  _upsellTargetId = suggestedId;

  // Find the specific card that was just clicked
  const card = document.querySelector('[data-product-id="' + addedId + '"]');
  if (!card) return;

  // Remove any existing inline upsell (e.g. from a rapid double-click)
  _dismissUpsellPopup();

  // Build the inline row
  const inline = document.createElement('div');
  inline.id = 'upsell-inline';
  inline.style.cssText = 'margin-top:8px;padding:8px 10px;background:#fff5f7;border:1px solid #f0b8c8;border-radius:10px;display:flex;align-items:center;gap:8px;font-size:11px;color:#1a1a2e;line-height:1.35;';
  inline.innerHTML =
    '<span style="flex:1;">🛍 Customers also get <strong>' + suggested.emoji + ' ' + suggested.name + '</strong> (₹' + suggested.price.toFixed(2) + ')</span>' +
    '<button onclick="_addUpsellToCart()" style="flex-shrink:0;background:#e14868;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">Add</button>';

  // Append inside the card body (the p-4 flex column div)
  const body = card.querySelector('.p-4');
  if (body) body.appendChild(inline);

  logAuditEvent(
    'UPSELL_SUGGESTED',
    'Upsell suggested (manual): "' + suggested.name + '" after adding product id ' + addedId,
    suggested.price
  );

  clearTimeout(_upsellTimer);
  _upsellTimer = setTimeout(_dismissUpsellPopup, 6000);
}

function _dismissUpsellPopup() {
  const inline = document.getElementById('upsell-inline');
  if (inline) inline.remove();
  clearTimeout(_upsellTimer);
}

function _addUpsellToCart() {
  const id = _upsellTargetId;
  if (!id) return;
  const product = products.find(p => p.id === id);
  if (!product) return;

  _dismissUpsellPopup();
  _upsellTargetId = null;

  logAuditEvent(
    'UPSELL_ACCEPTED',
    'Upsell accepted (manual): "' + product.name + '" added from cross-sell suggestion',
    product.price
  );

  _isUpsellAdd = true;
  addToCart(id);   // adds without triggering another upsell popup
  _isUpsellAdd = false;
}

function updateCartUI() {
  const totalItems = Object.values(cart).reduce((sum, e) => sum + e.qty, 0);
  const totalPrice = Object.values(cart).reduce((sum, e) => sum + e.product.price * e.qty, 0);

  document.getElementById("cart-count").textContent = totalItems;

  const list     = document.getElementById("cart-items");
  const emptyMsg = document.getElementById("cart-empty");
  const totalEl  = document.getElementById("cart-total");
  list.innerHTML = "";

  if (totalItems === 0) {
    emptyMsg.style.display = "block";
    totalEl.textContent = "";
  } else {
    emptyMsg.style.display = "none";
    totalEl.textContent = "Total: " + formatPrice(totalPrice);
    Object.values(cart).forEach(({ product, qty }) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="item-name">${product.name}</span>
        <span class="item-qty">x${qty}</span>
        <span class="item-price">${formatPrice(product.price * qty)}</span>
      `;
      list.appendChild(li);
    });
  }
}

// ── Cart Dropdown Toggle ──────────────────────────────────────
function toggleCart() {
  document.getElementById("cart-dropdown").classList.toggle("open");
}

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("cart-dropdown");
  const cartIcon = document.getElementById("cart-icon");
  if (dropdown && cartIcon && !dropdown.contains(e.target) && !cartIcon.contains(e.target)) {
    dropdown.classList.remove("open");
  }
});

// ── Toast ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

// ── Init ──────────────────────────────────────────────────────
loadCart();
renderProducts();
updateCartUI();
