
#### `README.md`
```markdown
# ⚡ X Vortex

<p align="center">
  <img src="docs/assets/logo.svg" width="120" alt="X Vortex">
</p>

**AI-powered conversations for modern businesses — smart, fast, and delightfully animated.**

X Vortex turns product data, policies, FAQs, and workflows into context-aware, automated conversations that live where customers already are.

---

## Quick demo

Open `docs/demo/index.html` to see a lightweight animated hero, live message preview, and status badges.

---

## Features

| **Feature** | **Benefit** |
|---|---|
| **AI Conversations** | Context-aware replies and follow-ups |
| **Business Knowledge** | Brand-safe answers from product & policy data |
| **WhatsApp Integration** | Reach customers where they chat |
| **Automation** | Auto-responses, ticket creation, workflows |
| **Extensible** | Add CRM, analytics, payment hooks |

---

## How it works

**Flow**



Customer → Messaging Layer → AI Agent → Knowledge + Tools → Intelligent Reply → Customer


**Core steps**

- Understand incoming message and intent  
- Retrieve relevant business context and history  
- Reason using business rules and AI  
- Act: reply, call tools, update systems

---

## Animated demo (local)

1. Clone repo
2. `npm install` (optional for local server)
3. Open `docs/demo/index.html` in a browser

---

## Dev notes

- Keep secrets in `.env` only.  
- Start with a small knowledge set to iterate quickly.  
- Use modular components: Messaging, AI Agent, Knowledge, Tools.

---

## Roadmap

**Next:** AI agent, knowledge system, context memory, tool calling.  
**Later:** analytics, multi-business support, public launch.

---

## Contributing

Fork → branch → build → test → PR. Open an issue for major changes.

---

## License

Released under the **MIT License**. See `LICENSE`.

<p align="center">
  <img src="docs/assets/logo.svg" width="64" alt="X Vortex">
</p>


---

`docs/demo/index.html`

<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>X Vortex — Demo</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero">
    <div class="hero-left">
      <div class="logo-wrap" aria-hidden="true">
        <!-- Inline SVG logo -->
        <svg class="vortex" viewBox="0 0 120 120" width="120" height="120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="X Vortex logo">
          <defs>
            <linearGradient id="g" x1="0" x2="1">
              <stop offset="0" stop-color="#8A2BE2"/>
              <stop offset="1" stop-color="#25D366"/>
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <g filter="url(#glow)">
            <path class="ring ring-1" d="M60 10 A50 50 0 0 1 110 60" stroke="url(#g)" stroke-width="6" fill="none" stroke-linecap="round"/>
            <path class="ring ring-2" d="M110 60 A50 50 0 0 1 60 110" stroke="#F5C542" stroke-width="4" fill="none" stroke-linecap="round"/>
            <circle cx="60" cy="60" r="6" fill="#fff"/>
          </g>
        </svg>
      </div>
      <h1>⚡ X Vortex</h1>
      <p class="tagline"><strong>AI-powered conversations for modern businesses.</strong></p>
      <p class="lead">Context-aware replies, automation, and integrations — built to scale.</p>
      <div class="badges">
        <span class="badge coming">Coming soon</span>
        <span class="badge ai">AI Agent</span>
        <span class="badge wa">WhatsApp</span>
      </div>
      <div class="cta-row">
        <a class="btn primary" href="#features">Explore features</a>
        <a class="btn ghost" href="https://github.com/YOUR_USERNAME/X-Vortex">GitHub</a>
      </div>
    </div>

    <aside class="hero-right">
      <div class="preview-card">
        <div class="preview-header">
          <div class="dot green"></div>
          <div class="dot yellow"></div>
          <div class="dot red"></div>
        </div>
        <div class="messages" id="messages">
          <div class="msg incoming">Hi — what's the status of order <strong>#A1234</strong>?</div>
          <div class="msg outgoing">Checking order A1234…</div>
          <div class="msg incoming">Thanks — can I change the delivery address?</div>
        </div>
        <div class="composer">
          <input id="composer" placeholder="Type a message…" />
          <button id="send">Send</button>
        </div>
      </div>
      <div class="small-note">Live preview — animated micro-interactions</div>
    </aside>
  </header>

  <main class="content">
    <section id="features" class="grid">
      <article>
        <h3>AI Conversations</h3>
        <p>Context-aware replies, follow-ups, and intent handling that respect your brand voice.</p>
      </article>
      <article>
        <h3>Business Knowledge</h3>
        <p>Teach the assistant product specs, policies, and workflows for accurate answers.</p>
      </article>
      <article>
        <h3>Automation</h3>
        <p>Auto-responses, ticket creation, and tool-calls to reduce repetitive work.</p>
      </article>
    </section>
  </main>

  <footer class="footer">
    <div>© <strong>X Vortex</strong> · MIT License</div>
  </footer>

  <script>
    // Minimal interactive behavior and subtle animations
    const composer = document.getElementById('composer');
    const send = document.getElementById('send');
    const messages = document.getElementById('messages');

    send.addEventListener('click', () => {
      const text = composer.value.trim();
      if (!text) return;
      const out = document.createElement('div');
      out.className = 'msg outgoing typing';
      out.textContent = text;
      messages.appendChild(out);
      composer.value = '';
      messages.scrollTop = messages.scrollHeight;

      // Simulate AI thinking and animated reply
      setTimeout(() => {
        out.classList.remove('typing');
        const reply = document.createElement('div');
        reply.className = 'msg incoming';
        reply.innerHTML = 'Sure — I can update that. Which address should I use?';
        messages.appendChild(reply);
        messages.scrollTop = messages.scrollHeight;
      }, 900);
    });

    composer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send.click();
    });
  </script>
</body>
</html>


---

`docs/demo/styles.css`

:root{
  --bg:#0f1724;
  --card:#0b1220;
  --muted:#9aa4b2;
  --accent1:#8A2BE2;
  --accent2:#25D366;
  --accent3:#F5C542;
  --glass: rgba(255,255,255,0.03);
  --radius:12px;
  --mono: 'Inter', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:var(--mono);
  background:linear-gradient(180deg,#071021 0%, #071827 60%);
  color:#e6eef6;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  padding:32px;
}

/* Hero layout */
.hero{
  display:flex;
  gap:28px;
  align-items:flex-start;
  max-width:1100px;
  margin:0 auto 28px;
}
.hero-left{flex:1;min-width:360px}
.hero-right{width:420px}

/* Logo animation */
.logo-wrap{display:flex;align-items:center;gap:14px}
.vortex{display:block}
@keyframes slow-spin{to{transform:rotate(360deg)}}
.ring{transform-origin:60px 60px; animation: slow-spin 10s linear infinite}
.ring-2{animation-direction:reverse; animation-duration:14s}

/* Text */
h1{margin:8px 0 6px;font-size:28px}
.tagline{margin:0 0 8px;color:var(--muted)}
.lead{margin:0 0 14px;color:#cfe6ff}

/* Badges & CTA */
.badges{display:flex;gap:8px;margin-bottom:14px}
.badge{padding:6px 10px;border-radius:999px;font-size:13px;color:#071827;background:var(--glass)}
.badge.coming{background:linear-gradient(90deg,#F5C542,#F2A541);color:#071827}
.badge.ai{background:linear-gradient(90deg,#8A2BE2,#6f4be6)}
.badge.wa{background:linear-gradient(90deg,#25D366,#1fbf5a)}

.cta-row{display:flex;gap:10px;margin-top:6px}
.btn{padding:10px 14px;border-radius:10px;text-decoration:none;color:inherit;font-weight:600}
.btn.primary{background:linear-gradient(90deg,var(--accent1),var(--accent2));color:white;box-shadow:0 6px 18px rgba(40,20,80,0.25)}
.btn.ghost{background:transparent;border:1px solid rgba(255,255,255,0.06)}

/* Preview card */
.preview-card{
  background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
  border-radius:14px;padding:12px;width:100%;
  box-shadow: 0 8px 30px rgba(2,6,23,0.6);
  border:1px solid rgba(255,255,255,0.03);
}
.preview-header{display:flex;gap:8px;padding:6px}
.dot{width:10px;height:10px;border-radius:50%}
.dot.green{background:#25D366}
.dot.yellow{background:#F5C542}
.dot.red{background:#FF6B6B}

.messages{max-height:260px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:86%;padding:10px 12px;border-radius:10px;line-height:1.3}
.msg.incoming{align-self:flex-start;background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.02)}
.msg.outgoing{align-self:flex-end;background:linear-gradient(180deg,#1b2a3a,#12202b);border:1px solid rgba(255,255,255,0.02)}
.msg.typing{opacity:0.85;filter:blur(0.2px);transform:translateY(4px);transition:all .25s ease}

/* Composer */
.composer{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,0.02)}
.composer input{flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.03);background:transparent;color:inherit}
.composer button{padding:10px 12px;border-radius:10px;background:linear-gradient(90deg,var(--accent1),var(--accent2));border:none;color:white;font-weight:700}

/* Content grid */
.content{max-width:1100px;margin:18px auto;padding:0 6px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.grid article{background:rgba(255,255,255,0.02);padding:18px;border-radius:12px;border:1px solid rgba(255,255,255,0.02)}

/* Footer */
.footer{text-align:center;color:var(--muted);margin-top:28px;font-size:13px}

/* Responsive */
@media (max-width:980px){
  .hero{flex-direction:column}
  .hero-right{width:100%}
  .grid{grid-template-columns:1fr}
}


---

`docs/assets/logo.svg`

<!-- Minimal brand SVG for docs/assets/logo.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="X Vortex">
  <defs>
    <linearGradient id="lg" x1="0" x2="1">
      <stop offset="0" stop-color="#8A2BE2"/>
      <stop offset="1" stop-color="#25D366"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="20" fill="url(#lg)"/>
  <g transform="translate(12,12)" fill="#fff">
    <path d="M48 8c-12 0-22 10-22 22s10 22 22 22 22-10 22-22S60 8 48 8zm0 8a14 14 0 1 1 0 28 14 14 0 0 1 0-28z"/>
  </g>
</svg>


---

`package.json` (optional)

{
  "name": "x-vortex-demo",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "npx http-server docs/demo -c-1 -p 8080",
    "dev": "npm run start"
  },
  "devDependencies": {
    "http-server": "^14.1.1"
  }
}


---

Notes and tips

• Files to add to repo: README.md, docs/demo/index.html, docs/demo/styles.css, docs/assets/logo.svg, optional package.json.
• Animation: The SVG rings rotate using CSS @keyframes for a lightweight, accessible effect. Replace the SVG with your full brand mark if available.
• Lottie: For richer micro-animations, add Lottie JSON and a small player; keep them small to preserve performance.
• Extensibility: Use the demo as a visual front-end for your real backend: wire the composer to your webhook or local mock to test AI replies.
• Security: Never commit API keys. Use .env for secrets and .env.example for placeholders.