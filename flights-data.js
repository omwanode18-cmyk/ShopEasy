/**
 * flights-data.js  —  Mock domestic flight dataset
 * Loaded on both flights.html (page search) and index.html (AI chatbot search).
 * Keep in sync with SHOP_PRODUCTS in server.js if routes change.
 */
const flightData = [

  // ── Pune → Bangalore ────────────────────────────────────────
  { id:"F001", airline:"IndiGo",   flightNo:"6E-256", from:"Pune",    to:"Bangalore", date:"2026-09-05", departure:"06:00", arrival:"07:25", duration:"1h 25m", durationMins:85,  price:3299 },
  { id:"F002", airline:"SpiceJet", flightNo:"SG-108", from:"Pune",    to:"Bangalore", date:"2026-09-05", departure:"10:30", arrival:"12:00", duration:"1h 30m", durationMins:90,  price:2899 },
  { id:"F003", airline:"Vistara",  flightNo:"UK-870", from:"Pune",    to:"Bangalore", date:"2026-09-05", departure:"17:00", arrival:"18:30", duration:"1h 30m", durationMins:90,  price:4799 },
  { id:"F004", airline:"IndiGo",   flightNo:"6E-258", from:"Pune",    to:"Bangalore", date:"2026-09-10", departure:"07:15", arrival:"08:45", duration:"1h 30m", durationMins:90,  price:3499 },
  { id:"F005", airline:"Air India", flightNo:"AI-403", from:"Pune",   to:"Bangalore", date:"2026-09-10", departure:"13:45", arrival:"15:20", duration:"1h 35m", durationMins:95,  price:5199 },

  // ── Mumbai → Delhi ───────────────────────────────────────────
  { id:"F006", airline:"Air India", flightNo:"AI-865", from:"Mumbai", to:"Delhi",     date:"2026-09-05", departure:"09:00", arrival:"11:15", duration:"2h 15m", durationMins:135, price:5499 },
  { id:"F007", airline:"IndiGo",   flightNo:"6E-704", from:"Mumbai",  to:"Delhi",     date:"2026-09-05", departure:"13:00", arrival:"15:10", duration:"2h 10m", durationMins:130, price:4299 },
  { id:"F008", airline:"SpiceJet", flightNo:"SG-422", from:"Mumbai",  to:"Delhi",     date:"2026-09-05", departure:"18:30", arrival:"20:50", duration:"2h 20m", durationMins:140, price:3899 },
  { id:"F009", airline:"Vistara",  flightNo:"UK-955", from:"Mumbai",  to:"Delhi",     date:"2026-09-10", departure:"07:00", arrival:"09:10", duration:"2h 10m", durationMins:130, price:6799 },

  // ── Delhi → Goa ──────────────────────────────────────────────
  { id:"F010", airline:"IndiGo",   flightNo:"6E-128", from:"Delhi",   to:"Goa",       date:"2026-09-05", departure:"08:00", arrival:"10:30", duration:"2h 30m", durationMins:150, price:4999 },
  { id:"F011", airline:"Air India", flightNo:"AI-545", from:"Delhi",  to:"Goa",       date:"2026-09-05", departure:"14:00", arrival:"16:40", duration:"2h 40m", durationMins:160, price:5899 },
  { id:"F012", airline:"GoAir",    flightNo:"G8-119", from:"Delhi",   to:"Goa",       date:"2026-09-05", departure:"19:00", arrival:"21:25", duration:"2h 25m", durationMins:145, price:3799 },
  { id:"F013", airline:"SpiceJet", flightNo:"SG-765", from:"Delhi",   to:"Goa",       date:"2026-09-10", departure:"11:00", arrival:"13:30", duration:"2h 30m", durationMins:150, price:4299 },

  // ── Chennai → Hyderabad ──────────────────────────────────────
  { id:"F014", airline:"IndiGo",   flightNo:"6E-517", from:"Chennai", to:"Hyderabad", date:"2026-09-05", departure:"07:30", arrival:"08:45", duration:"1h 15m", durationMins:75,  price:2699 },
  { id:"F015", airline:"Air India", flightNo:"AI-562", from:"Chennai",to:"Hyderabad", date:"2026-09-05", departure:"12:00", arrival:"13:20", duration:"1h 20m", durationMins:80,  price:3299 },
  { id:"F016", airline:"Vistara",  flightNo:"UK-841", from:"Chennai", to:"Hyderabad", date:"2026-09-05", departure:"16:30", arrival:"17:50", duration:"1h 20m", durationMins:80,  price:4199 },
  { id:"F017", airline:"SpiceJet", flightNo:"SG-334", from:"Chennai", to:"Hyderabad", date:"2026-09-10", departure:"09:15", arrival:"10:35", duration:"1h 20m", durationMins:80,  price:2599 },

  // ── Bangalore → Mumbai ───────────────────────────────────────
  { id:"F018", airline:"IndiGo",   flightNo:"6E-382", from:"Bangalore",to:"Mumbai",   date:"2026-09-05", departure:"06:30", arrival:"08:15", duration:"1h 45m", durationMins:105, price:3799 },
  { id:"F019", airline:"SpiceJet", flightNo:"SG-213", from:"Bangalore",to:"Mumbai",   date:"2026-09-05", departure:"11:00", arrival:"12:50", duration:"1h 50m", durationMins:110, price:3199 },
  { id:"F020", airline:"Vistara",  flightNo:"UK-801", from:"Bangalore",to:"Mumbai",   date:"2026-09-10", departure:"15:00", arrival:"16:50", duration:"1h 50m", durationMins:110, price:5999 },
];
