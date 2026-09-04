# ShopEasy — AI Agentic Commerce (Razorpay Hackathon, Track 1)

🔗 Live Demo: https://shopeasy-6mjc.onrender.com

> Note: this is hosted on a free tier, so the first load after inactivity may take 
> ~50 seconds to wake up. Please be patient on first click.

## What This Is
ShopEasy is an e-commerce site with real Razorpay test-mode payments, plus an AI 
shopping agent that can find products, book flights, add items to cart, and 
complete checkout — entirely through natural conversation. Every money action is 
explainable, bounded, and logged, with mandatory human confirmation before any 
payment.

## Key Features
- AI chatbot (natural language understanding, handles typos/casual phrasing)
- Full agentic checkout via chat, with explicit "Pay by AI" confirmation required
- Bounded AI spending limit (auto-add capped at ₹5,500)
- Full audit trail of every AI action (view at /audit-log.html)
- Graceful payment failure handling
- Flight booking, also usable via chat
- Upsell/cross-sell suggestions (manual + AI)

## Tech Stack
HTML/CSS/JS frontend, Node.js + Express backend, Razorpay test-mode payment API, 
Groq API (Llama 3.3) for AI understanding.
