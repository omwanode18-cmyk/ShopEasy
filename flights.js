/**
 * flights.js  —  Flight search page logic (flights.html)
 *
 * Depends on: flights-data.js (flightData), app.js (cart, saveCart, updateCartUI,
 *             showToast, formatPrice), audit.js (logAuditEvent)
 */

// ── Search & Render ───────────────────────────────────────────

function searchFlights() {
  const from  = document.getElementById('from-city').value.trim().toLowerCase();
  const to    = document.getElementById('to-city').value.trim().toLowerCase();
  const date  = document.getElementById('flight-date').value;

  const results = flightData.filter(f => {
    const fromOk = !from || f.from.toLowerCase().includes(from) || from.includes(f.from.toLowerCase());
    const toOk   = !to   || f.to.toLowerCase().includes(to)     || to.includes(f.to.toLowerCase());
    const dateOk = !date || f.date === date;
    return fromOk && toOk && dateOk;
  });

  results.sort((a, b) => a.price - b.price);   // default: cheapest first
  renderFlightResults(results, from, to, date);
}

function renderFlightResults(results, from, to, date) {
  const container = document.getElementById('flight-results');
  container.innerHTML = '';

  if (results.length === 0) {
    const fromLabel = from ? _capitalize(from) : 'anywhere';
    const toLabel   = to   ? _capitalize(to)   : 'anywhere';
    container.innerHTML = `
      <div class="text-center py-16 text-gray-400">
        <div class="text-5xl mb-4">🔍</div>
        <p class="text-lg font-semibold text-gray-500">No flights found</p>
        <p class="text-sm mt-1">No flights from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>${date ? ' on ' + _fmtDate(date) : ''}.</p>
        <p class="text-sm mt-1 text-gray-400">Try different cities or leave the date blank to see all available dates.</p>
      </div>`;
    return;
  }

  results.forEach(f => {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-5 flex items-center gap-6 hover:shadow-md transition-shadow duration-200';
    card.innerHTML = `
      <!-- Airline icon -->
      <div class="flex-shrink-0 w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">✈️</div>

      <!-- Airline + times -->
      <div class="flex-1 min-w-0">
        <p class="font-bold text-[#1a1a2e] text-base">${f.airline}</p>
        <p class="text-gray-500 text-sm mt-0.5">${f.flightNo} &nbsp;·&nbsp; ${f.from} → ${f.to} &nbsp;·&nbsp; ${_fmtDate(f.date)}</p>
        <p class="text-gray-700 text-sm mt-1 font-medium">${f.departure} <span class="text-gray-400">→</span> ${f.arrival}</p>
      </div>

      <!-- Duration -->
      <div class="hidden sm:block flex-shrink-0 text-center">
        <p class="text-xs text-gray-400 uppercase tracking-wide">Duration</p>
        <p class="font-semibold text-gray-600 mt-0.5">${f.duration}</p>
      </div>

      <!-- Price + Book -->
      <div class="flex-shrink-0 text-right flex flex-col items-end gap-2">
        <p class="text-[#e14868] font-extrabold text-3xl leading-none">₹${f.price.toLocaleString()}</p>
        <button onclick="bookFlight('${f.id}')"
                class="border-2 border-[#1a1a2e] text-[#1a1a2e] hover:bg-[#1a1a2e] hover:text-white
                       text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors duration-200 whitespace-nowrap">
          Book This Flight
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Booking ───────────────────────────────────────────────────

function bookFlight(flightId) {
  const flight = flightData.find(f => f.id === flightId);
  if (!flight) return;

  const cartKey = 'flight-' + flight.id;
  const label   = flight.airline + ' ' + flight.flightNo + ' (' + flight.from + ' → ' + flight.to + ', ' + _fmtDate(flight.date) + ')';

  // Prevent duplicate booking of same flight
  if (cart[cartKey]) {
    showToast('This flight is already in your cart!');
    return;
  }

  cart[cartKey] = {
    product: { id: cartKey, name: label, price: flight.price, emoji: '✈️' },
    qty: 1,
  };
  saveCart();
  updateCartUI();

  logAuditEvent(
    'FLIGHT_BOOKED',
    'Flight ' + flight.flightNo + ' (' + flight.from + '→' + flight.to + ') added to cart via Flights page',
    flight.price
  );

  showToast('✈️ ' + flight.airline + ' ' + flight.flightNo + ' added to cart!');
}

// ── Helpers ───────────────────────────────────────────────────

function _capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  } catch (_) { return dateStr; }
}

// ── Init: show all flights on page load ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderFlightResults(flightData.slice().sort((a, b) => a.price - b.price), '', '', '');
});
