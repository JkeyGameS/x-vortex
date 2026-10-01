<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#050510" />
  <meta
    name="description"
    content="X Vortex — The AI Operating Layer for Modern Businesses."
  />
  <title>X Vortex — AI Operating Layer</title>

  <style>
    /* =========================================================
       X VORTEX — DESIGN SYSTEM
    ========================================================= */

    :root {
      --bg: #050510;
      --bg-soft: #07152f;
      --surface: rgba(10, 18, 42, 0.58);
      --surface-strong: rgba(11, 22, 49, 0.82);
      --cyan: #00d9ff;
      --blue: #2563ff;
      --violet: #7c3aed;
      --purple: #a855f7;
      --white: #f8fbff;
      --text: #d8e5f7;
      --muted: #7e91ae;
      --line: rgba(113, 163, 255, 0.17);
      --line-bright: rgba(0, 217, 255, 0.35);
      --success: #35f0b1;

      --container: min(1180px, calc(100% - 48px));
      --nav-height: 82px;

      --shadow:
        0 24px 90px rgba(0, 0, 0, 0.48),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);

      --glow-cyan:
        0 0 25px rgba(0, 217, 255, 0.24),
        0 0 70px rgba(0, 217, 255, 0.08);

      --glow-violet:
        0 0 30px rgba(124, 58, 237, 0.28),
        0 0 80px rgba(168, 85, 247, 0.1);

      --ease: cubic-bezier(.2, .8, .2, 1);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
      background: var(--bg);
    }

    body {
      min-height: 100vh;
      overflow-x: hidden;
      color: var(--text);
      background:
        radial-gradient(circle at 50% -10%, rgba(37, 99, 255, 0.15), transparent 35%),
        radial-gradient(circle at 90% 35%, rgba(124, 58, 237, 0.08), transparent 28%),
        var(--bg);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -3;
      pointer-events: none;
      opacity: 0.24;
      background-image:
        linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
      background-size: 80px 80px;
      mask-image: linear-gradient(to bottom, black, transparent 75%);
    }

    ::selection {
      color: #001018;
      background: var(--cyan);
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    button,
    a {
      -webkit-tap-highlight-color: transparent;
    }

    button {
      font: inherit;
    }

    img,
    svg {
      display: block;
      max-width: 100%;
    }

    .container {
      width: var(--container);
      margin-inline: auto;
    }

    .section {
      position: relative;
      padding: 130px 0;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 18px;
      color: var(--cyan);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }

    .eyebrow::before {
      content: "";
      width: 24px;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--cyan));
      box-shadow: 0 0 10px var(--cyan);
    }

    .section-heading {
      max-width: 780px;
      margin-bottom: 62px;
    }

    .section-heading h2 {
      color: var(--white);
      font-size: clamp(2.25rem, 5vw, 4.6rem);
      font-weight: 650;
      letter-spacing: -.055em;
      line-height: .98;
    }

    .section-heading h2 span {
      background: linear-gradient(100deg, var(--white), #90dfff 48%, #a875ff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .section-heading p {
      max-width: 650px;
      margin-top: 22px;
      color: var(--muted);
      font-size: 1.04rem;
    }

    /* =========================================================
       LOADER
    ========================================================= */

    .loader {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: grid;
      place-items: center;
      background: #030309;
      transition: opacity .7s var(--ease), visibility .7s;
    }

    .loader.is-done {
      opacity: 0;
      visibility: hidden;
    }

    .loader-core {
      position: relative;
      width: 90px;
      height: 90px;
    }

    .loader-core::before,
    .loader-core::after {
      content: "";
      position: absolute;
      inset: 0;
      border: 1px solid transparent;
      border-top-color: var(--cyan);
      border-right-color: var(--violet);
      border-radius: 50%;
      animation: spin 1.2s linear infinite;
    }

    .loader-core::after {
      inset: 12px;
      border-top-color: var(--purple);
      border-left-color: var(--cyan);
      animation-duration: .8s;
      animation-direction: reverse;
    }

    .loader-label {
      position: absolute;
      top: calc(100% + 22px);
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      color: #6e86a8;
      font-size: .65rem;
      font-weight: 700;
      letter-spacing: .25em;
      text-transform: uppercase;
    }

    /* =========================================================
       HEADER
    ========================================================= */

    .site-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      height: var(--nav-height);
      border-bottom: 1px solid transparent;
      background: rgba(5, 5, 16, 0);
      transition:
        background .35s ease,
        border-color .35s ease,
        backdrop-filter .35s ease;
    }

    .site-header.scrolled {
      border-color: var(--line);
      background: rgba(5, 5, 16, .72);
      backdrop-filter: blur(20px) saturate(140%);
    }

    .nav {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 11px;
      color: var(--white);
      font-weight: 800;
      letter-spacing: -.04em;
    }

    .brand-mark {
      position: relative;
      width: 35px;
      height: 35px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(0, 217, 255, .55);
      border-radius: 11px;
      background:
        radial-gradient(circle at 35% 30%, #a855f7, transparent 30%),
        linear-gradient(145deg, rgba(0,217,255,.2), rgba(124,58,237,.22));
      box-shadow: var(--glow-cyan);
      overflow: hidden;
    }

    .brand-mark::before {
      content: "X";
      color: white;
      font-size: .9rem;
      font-weight: 900;
      text-shadow: 0 0 12px var(--cyan);
    }

    .brand-name {
      font-size: 1.08rem;
    }

    .brand-name span {
      color: var(--cyan);
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 30px;
      margin-left: auto;
      margin-right: 30px;
    }

    .nav-links a {
      position: relative;
      color: #91a3bd;
      font-size: .82rem;
      font-weight: 650;
      transition: color .25s ease;
    }

    .nav-links a::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: -7px;
      width: 0;
      height: 1px;
      background: var(--cyan);
      box-shadow: 0 0 10px var(--cyan);
      transition: width .3s var(--ease);
    }

    .nav-links a:hover,
    .nav-links a:focus-visible {
      color: var(--white);
    }

    .nav-links a:hover::after,
    .nav-links a:focus-visible::after {
      width: 100%;
    }

    .nav-cta {
      padding: 10px 17px;
      border: 1px solid rgba(0, 217, 255, .35);
      border-radius: 100px;
      color: var(--white);
      background: rgba(0, 217, 255, .07);
      font-size: .78rem;
      font-weight: 750;
      transition: .3s var(--ease);
    }

    .nav-cta:hover,
    .nav-cta:focus-visible {
      border-color: var(--cyan);
      background: rgba(0, 217, 255, .13);
      box-shadow: var(--glow-cyan);
    }

    .menu-toggle {
      display: none;
      width: 42px;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--white);
      background: rgba(255,255,255,.035);
      cursor: pointer;
    }

    .menu-toggle span,
    .menu-toggle span::before,
    .menu-toggle span::after {
      display: block;
      width: 17px;
      height: 1px;
      margin: auto;
      background: currentColor;
      transition: .3s ease;
    }

    .menu-toggle span {
      position: relative;
    }

    .menu-toggle span::before,
    .menu-toggle span::after {
      content: "";
      position: absolute;
      left: 0;
    }

    .menu-toggle span::before {
      top: -6px;
    }

    .menu-toggle span::after {
      top: 6px;
    }

    /* =========================================================
       HERO
    ========================================================= */

    .hero {
      position: relative;
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding-top: 100px;
      overflow: hidden;
      isolation: isolate;
    }

    #particleCanvas {
      position: absolute;
      inset: 0;
      z-index: -4;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .hero-vignette {
      position: absolute;
      inset: 0;
      z-index: -3;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 43%, transparent 0 16%, rgba(5,5,16,.1) 38%, rgba(5,5,16,.88) 100%),
        linear-gradient(to bottom, rgba(5,5,16,.15), transparent 40%, #050510 100%);
    }

    .vortex {
      position: absolute;
      left: 50%;
      top: 44%;
      width: min(900px, 90vw);
      aspect-ratio: 1;
      z-index: -2;
      transform: translate(-50%, -50%);
      pointer-events: none;
      opacity: .8;
    }

    .vortex::before,
    .vortex::after {
      content: "";
      position: absolute;
      inset: 5%;
      border-radius: 50%;
      background:
        conic-gradient(
          from 20deg,
          transparent,
          rgba(0,217,255,.2),
          transparent 18%,
          rgba(124,58,237,.2),
          transparent 40%,
          rgba(0,217,255,.18),
          transparent 64%,
          rgba(168,85,247,.18),
          transparent 84%
        );
      mask-image: radial-gradient(circle, transparent 36%, black 38%, black 48%, transparent 51%, black 54%, transparent 57%, black 60%, transparent 64%);
      animation: vortexSpin 24s linear infinite;
      filter: blur(1px);
    }

    .vortex::after {
      inset: 16%;
      animation-duration: 15s;
      animation-direction: reverse;
      opacity: .8;
      transform: rotate(20deg);
    }

    .vortex-core {
      position: absolute;
      inset: 35%;
      border-radius: 50%;
      background:
        radial-gradient(circle,
          rgba(255,255,255,.8) 0,
          rgba(0,217,255,.35) 5%,
          rgba(37,99,255,.15) 20%,
          rgba(124,58,237,.08) 43%,
          transparent 70%);
      filter: blur(15px);
      animation: corePulse 4s ease-in-out infinite;
    }

    .hero-grid {
      position: absolute;
      left: 50%;
      bottom: -25%;
      width: 150%;
      height: 70%;
      transform: translateX(-50%) perspective(500px) rotateX(65deg);
      transform-origin: center top;
      z-index: -2;
      opacity: .12;
      background-image:
        linear-gradient(rgba(0,217,255,.3) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,217,255,.3) 1px, transparent 1px);
      background-size: 70px 70px;
      mask-image: linear-gradient(to top, black, transparent);
    }

    .hero-content {
      position: relative;
      width: min(100%, 1050px);
      text-align: center;
    }

    .hero-kicker {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 7px 13px;
      margin-bottom: 25px;
      border: 1px solid rgba(0,217,255,.2);
      border-radius: 100px;
      color: #9bb5d4;
      background: rgba(0,217,255,.045);
      box-shadow: inset 0 0 30px rgba(0,217,255,.025);
      font-size: .69rem;
      font-weight: 750;
      letter-spacing: .13em;
      text-transform: uppercase;
      opacity: 0;
      transform: translateY(20px);
      animation: revealUp .9s .2s var(--ease) forwards;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 12px var(--success);
      animation: statusPulse 2s ease-in-out infinite;
    }

    .hero-title {
      max-width: 1000px;
      margin-inline: auto;
      color: var(--white);
      font-size: clamp(3.25rem, 8.5vw, 7.8rem);
      font-weight: 600;
      letter-spacing: -.075em;
      line-height: .9;
      text-wrap: balance;
      opacity: 0;
      transform: translateY(35px);
      animation: revealUp 1s .35s var(--ease) forwards;
    }

    .hero-title .gradient {
      background:
        linear-gradient(
          105deg,
          #fff 10%,
          #b9efff 37%,
          #00d9ff 53%,
          #7c3aed 78%,
          #e7d7ff
        );
      background-size: 220% auto;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: gradientFlow 7s linear infinite;
    }

    .hero-subtitle {
      max-width: 620px;
      margin: 30px auto 0;
      color: #90a2bb;
      font-size: clamp(1rem, 2vw, 1.2rem);
      opacity: 0;
      transform: translateY(25px);
      animation: revealUp .9s .5s var(--ease) forwards;
    }

    .hero-actions {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-top: 35px;
      opacity: 0;
      transform: translateY(25px);
      animation: revealUp .9s .65s var(--ease) forwards;
    }

    .btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 48px;
      padding: 0 22px;
      border: 1px solid transparent;
      border-radius: 14px;
      cursor: pointer;
      font-size: .82rem;
      font-weight: 800;
      letter-spacing: -.01em;
      overflow: hidden;
      transition:
        transform .3s var(--ease),
        box-shadow .3s ease,
        border-color .3s ease,
        background .3s ease;
    }

    .btn::before {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-110%);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.2), transparent);
      transition: transform .6s ease;
    }

    .btn:hover::before,
    .btn:focus-visible::before {
      transform: translateX(110%);
    }

    .btn:hover,
    .btn:focus-visible {
      transform: translateY(-3px);
    }

    .btn-primary {
      color: #001018;
      background: linear-gradient(110deg, #00d9ff, #53cfff 45%, #7c3aed);
      box-shadow:
        0 10px 35px rgba(0,217,255,.15),
        0 0 40px rgba(124,58,237,.08);
    }

    .btn-primary:hover,
    .btn-primary:focus-visible {
      box-shadow:
        0 16px 45px rgba(0,217,255,.24),
        0 0 50px rgba(124,58,237,.18);
    }

    .btn-secondary {
      color: #c8d8ed;
      border-color: rgba(133,161,202,.2);
      background: rgba(255,255,255,.035);
      backdrop-filter: blur(15px);
    }

    .btn-secondary:hover,
    .btn-secondary:focus-visible {
      border-color: rgba(0,217,255,.45);
      color: white;
      background: rgba(0,217,255,.07);
      box-shadow: var(--glow-cyan);
    }

    .hero-robot {
      position: relative;
      width: min(370px, 55vw);
      height: 370px;
      margin: 65px auto 0;
      opacity: 0;
      transform: translateY(35px) scale(.94);
      animation: robotIn 1.2s .65s var(--ease) forwards;
    }

    .robot-aura {
      position: absolute;
      inset: 7%;
      border-radius: 50%;
      background:
        radial-gradient(circle,
          rgba(0,217,255,.22),
          rgba(37,99,255,.1) 32%,
          rgba(124,58,237,.13) 55%,
          transparent 70%);
      filter: blur(18px);
      animation: auraPulse 4s ease-in-out infinite;
    }

    .robot-ring {
      position: absolute;
      inset: 8%;
      border: 1px solid rgba(0,217,255,.23);
      border-radius: 50%;
      box-shadow:
        0 0 40px rgba(0,217,255,.1),
        inset 0 0 50px rgba(124,58,237,.05);
      animation: ringSpin 18s linear infinite;
    }

    .robot-ring::before,
    .robot-ring::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      border: 1px solid rgba(168,85,247,.35);
    }

    .robot-ring::before {
      inset: 11%;
    }

    .robot-ring::after {
      inset: -5%;
      border-top-color: transparent;
      border-left-color: var(--cyan);
      animation: ringSpin 9s linear infinite reverse;
    }

    .robot-image-wrap {
      position: absolute;
      inset: 12%;
      display: grid;
      place-items: center;
      animation: floatRobot 5s ease-in-out infinite;
      transform-style: preserve-3d;
    }

    .robot-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter:
        drop-shadow(0 0 12px rgba(0,217,255,.7))
        drop-shadow(0 0 38px rgba(124,58,237,.3));
    }

    .robot-fallback {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .hero-scroll {
      position: absolute;
      bottom: 27px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      color: #607492;
      font-size: .64rem;
      font-weight: 750;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .scroll-line {
      position: relative;
      width: 1px;
      height: 30px;
      overflow: hidden;
      background: rgba(255,255,255,.12);
    }

    .scroll-line::after {
      content: "";
      position: absolute;
      top: -100%;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--cyan);
      box-shadow: 0 0 12px var(--cyan);
      animation: scrollDown 1.8s ease-in-out infinite;
    }

    /* =========================================================
       MARQUEE
    ========================================================= */

    .marquee {
      position: relative;
      padding: 22px 0;
      border-block: 1px solid rgba(90,130,190,.11);
      overflow: hidden;
      background: rgba(255,255,255,.012);
    }

    .marquee-track {
      display: flex;
      width: max-content;
      animation: marquee 28s linear infinite;
    }

    .marquee-item {
      display: flex;
      align-items: center;
      gap: 30px;
      padding-right: 30px;
      color: #536984;
      font-size: .66rem;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }

    .marquee-item b {
      color: var(--cyan);
      font-size: .8rem;
    }

    /* =========================================================
       INTRO
    ========================================================= */

    .intro-layout {
      display: grid;
      grid-template-columns: .9fr 1.1fr;
      gap: 90px;
      align-items: center;
    }

    .intro-copy h2 {
      color: var(--white);
      font-size: clamp(2.5rem, 5vw, 5rem);
      letter-spacing: -.06em;
      line-height: .95;
    }

    .intro-copy h2 span {
      color: var(--cyan);
    }

    .intro-copy > p {
      max-width: 570px;
      margin-top: 25px;
      color: var(--muted);
      font-size: 1.02rem;
    }

    .terminal {
      position: relative;
      padding: 2px;
      border-radius: 26px;
      background: linear-gradient(130deg, rgba(0,217,255,.45), transparent 32%, rgba(124,58,237,.35));
      box-shadow: var(--shadow), var(--glow-cyan);
    }

    .terminal-inner {
      position: relative;
      min-height: 420px;
      padding: 25px;
      border-radius: 24px;
      overflow: hidden;
      background:
        radial-gradient(circle at 80% 20%, rgba(124,58,237,.14), transparent 32%),
        radial-gradient(circle at 20% 80%, rgba(0,217,255,.09), transparent 30%),
        #07101f;
    }

    .terminal-top {
      display: flex;
      align-items: center;
      gap: 7px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .terminal-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .terminal-dot:nth-child(1) { background: #ff5570; }
    .terminal-dot:nth-child(2) { background: #ffc857; }
    .terminal-dot:nth-child(3) { background: #35f0b1; }

    .terminal-title {
      margin-left: 8px;
      color: #607492;
      font-size: .65rem;
      letter-spacing: .1em;
    }

    .terminal-code {
      margin-top: 30px;
      color: #7890af;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: .78rem;
      line-height: 2;
    }

    .terminal-code .cyan { color: var(--cyan); }
    .terminal-code .violet { color: #b27aff; }
    .terminal-code .green { color: var(--success); }
    .terminal-code .white { color: #dbeaff; }

    .terminal-signal {
      position: absolute;
      right: 25px;
      bottom: 25px;
      width: 150px;
      height: 110px;
    }

    .signal-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 1px;
      background: rgba(0,217,255,.1);
    }

    .signal-line:nth-child(1) { top: 20%; }
    .signal-line:nth-child(2) { top: 50%; }
    .signal-line:nth-child(3) { top: 80%; }

    .signal-wave {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    .signal-wave::before {
      content: "";
      position: absolute;
      width: 220%;
      height: 2px;
      left: -40%;
      top: 50%;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--purple), transparent);
      box-shadow: 0 0 15px var(--cyan);
      transform: rotate(-8deg);
      animation: signalMove 2.6s ease-in-out infinite;
    }

    /* =========================================================
       CAPABILITIES
    ========================================================= */

    .capabilities {
      overflow: hidden;
    }

    .cap-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }

    .tilt-card {
      --mx: 50%;
      --my: 50%;
      position: relative;
      min-height: 270px;
      padding: 29px;
      border: 1px solid var(--line);
      border-radius: 24px;
      overflow: hidden;
      background:
        radial-gradient(circle at var(--mx) var(--my), rgba(0,217,255,.09), transparent 35%),
        linear-gradient(145deg, rgba(255,255,255,.035), rgba(255,255,255,.012));
      box-shadow: var(--shadow);
      transform-style: preserve-3d;
      transition:
        transform .18s ease,
        border-color .35s ease,
        background .35s ease;
      will-change: transform;
    }

    .tilt-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      padding: 1px;
      background: linear-gradient(135deg, rgba(0,217,255,.4), transparent 35%, transparent 65%, rgba(124,58,237,.3));
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      mask-composite: exclude;
      opacity: 0;
      transition: opacity .35s ease;
      pointer-events: none;
    }

    .tilt-card:hover {
      border-color: rgba(0,217,255,.35);
    }

    .tilt-card:hover::before {
      opacity: 1;
    }

    .cap-icon {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      margin-bottom: 28px;
      border: 1px solid rgba(0,217,255,.2);
      border-radius: 15px;
      color: var(--cyan);
      background: rgba(0,217,255,.06);
      box-shadow: inset 0 0 25px rgba(0,217,255,.06);
      transform: translateZ(30px);
    }

    .cap-icon svg {
      width: 22px;
      height: 22px;
    }

    .tilt-card h3 {
      color: var(--white);
      font-size: 1.08rem;
      letter-spacing: -.025em;
      transform: translateZ(20px);
    }

    .tilt-card p {
      max-width: 290px;
      margin-top: 10px;
      color: #7489a5;
      font-size: .83rem;
      line-height: 1.7;
      transform: translateZ(15px);
    }

    .cap-index {
      position: absolute;
      top: 27px;
      right: 28px;
      color: rgba(115,148,190,.25);
      font-family: monospace;
      font-size: .68rem;
    }

    /* =========================================================
       ARCHITECTURE
    ========================================================= */

    .architecture-wrap {
      position: relative;
      padding: 50px 35px;
      border: 1px solid var(--line);
      border-radius: 30px;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 50%, rgba(37,99,255,.08), transparent 40%),
        rgba(7, 15, 33, .55);
      box-shadow: var(--shadow);
    }

    .architecture-wrap::before {
      content: "";
      position: absolute;
      inset: 0;
      opacity: .25;
      background-image:
        linear-gradient(rgba(0,217,255,.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,217,255,.05) 1px, transparent 1px);
      background-size: 45px 45px;
      mask-image: radial-gradient(circle at center, black, transparent 75%);
    }

    .architecture {
      position: relative;
      display: grid;
      grid-template-columns: 1fr 1.4fr 1fr;
      align-items: center;
      gap: 25px;
      min-height: 490px;
    }

    .arch-column {
      display: flex;
      flex-direction: column;
      gap: 13px;
    }

    .arch-column.center {
      align-items: center;
    }

    .arch-node {
      position: relative;
      width: 100%;
      min-height: 73px;
      padding: 15px 17px;
      border: 1px solid rgba(102,145,203,.18);
      border-radius: 17px;
      background: rgba(8,18,39,.75);
      box-shadow: 0 14px 35px rgba(0,0,0,.2);
      transition: .35s var(--ease);
      cursor: pointer;
    }

    .arch-node:hover,
    .arch-node.active {
      border-color: rgba(0,217,255,.5);
      background: rgba(0,217,255,.06);
      box-shadow: 0 0 30px rgba(0,217,255,.1);
      transform: translateY(-2px);
    }

    .arch-node strong {
      display: block;
      color: #dcecff;
      font-size: .78rem;
    }

    .arch-node small {
      display: block;
      margin-top: 3px;
      color: #617895;
      font-size: .65rem;
    }

    .arch-node .node-icon {
      position: absolute;
      right: 15px;
      top: 50%;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      transform: translateY(-50%);
      border-radius: 9px;
      color: var(--cyan);
      background: rgba(0,217,255,.08);
      font-size: .7rem;
    }

    .arch-agent {
      position: relative;
      width: 225px;
      height: 225px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(0,217,255,.5);
      border-radius: 50%;
      background:
        radial-gradient(circle at 50% 50%, rgba(0,217,255,.15), rgba(37,99,255,.05) 35%, rgba(124,58,237,.07) 62%, transparent 70%),
        rgba(5,12,27,.8);
      box-shadow:
        0 0 45px rgba(0,217,255,.14),
        inset 0 0 45px rgba(124,58,237,.08);
    }

    .arch-agent::before,
    .arch-agent::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      border: 1px solid rgba(0,217,255,.16);
    }

    .arch-agent::before {
      inset: -18px;
      border-top-color: var(--cyan);
      border-bottom-color: var(--purple);
      animation: ringSpin 14s linear infinite;
    }

    .arch-agent::after {
      inset: -34px;
      border-left-color: rgba(168,85,247,.45);
      border-right-color: rgba(0,217,255,.35);
      animation: ringSpin 20s linear infinite reverse;
    }

    .agent-inner {
      text-align: center;
    }

    .agent-logo {
      width: 65px;
      height: 65px;
      margin: 0 auto 15px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(0,217,255,.5);
      border-radius: 20px;
      color: white;
      background: linear-gradient(145deg, rgba(0,217,255,.22), rgba(124,58,237,.2));
      box-shadow: var(--glow-cyan);
      font-size: 1.6rem;
      font-weight: 900;
    }

    .agent-inner strong {
      display: block;
      color: white;
      font-size: .95rem;
    }

    .agent-inner span {
      display: block;
      margin-top: 4px;
      color: var(--cyan);
      font-family: monospace;
      font-size: .6rem;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .arch-connector {
      position: absolute;
      z-index: -1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0,217,255,.4), transparent);
    }

    .connector-left {
      left: 27%;
      width: 23%;
      top: 50%;
    }

    .connector-right {
      right: 27%;
      width: 23%;
      top: 50%;
    }

    .data-packet {
      position: absolute;
      top: -2px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 0 10px var(--cyan);
    }

    .connector-left .data-packet {
      left: 0;
      animation: packetRight 2.4s linear infinite;
    }

    .connector-right .data-packet {
      right: 0;
      animation: packetRight 2.4s linear infinite reverse;
    }

    .arch-outcome {
      padding: 19px;
      border: 1px solid rgba(53,240,177,.2);
      border-radius: 18px;
      background: rgba(53,240,177,.035);
    }

    .arch-outcome strong {
      color: var(--success);
      font-size: .75rem;
    }

    .arch-outcome p {
      margin-top: 5px;
      color: #7690a8;
      font-size: .67rem;
    }

    .architecture-detail {
      margin-top: 30px;
      padding-top: 25px;
      border-top: 1px solid var(--line);
      text-align: center;
      color: #7287a4;
      font-size: .78rem;
    }

    .architecture-detail strong {
      color: var(--white);
    }

    /* =========================================================
       TIMELINE
    ========================================================= */

    .timeline {
      position: relative;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      margin-top: 75px;
    }

    .timeline-line {
      position: absolute;
      left: 12%;
      right: 12%;
      top: 27px;
      height: 1px;
      background: linear-gradient(90deg, var(--cyan), var(--blue), var(--violet), var(--purple));
      opacity: .35;
    }

    .timeline-progress {
      position: absolute;
      left: 12%;
      top: 26px;
      height: 3px;
      width: 0;
      border-radius: 10px;
      background: linear-gradient(90deg, var(--cyan), var(--violet));
      box-shadow: 0 0 14px rgba(0,217,255,.6);
      transition: width .8s var(--ease);
    }

    .timeline-step {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 0 18px;
    }

    .timeline-node {
      width: 55px;
      height: 55px;
      display: grid;
      place-items: center;
      margin: 0 auto 25px;
      border: 1px solid rgba(0,217,255,.25);
      border-radius: 50%;
      color: #7890ad;
      background: #07101f;
      box-shadow: 0 0 0 8px #050510;
      font-family: monospace;
      font-size: .7rem;
      transition: .5s var(--ease);
    }

    .timeline-step.active .timeline-node,
    .timeline-step:hover .timeline-node {
      border-color: var(--cyan);
      color: var(--cyan);
      box-shadow:
        0 0 0 8px #050510,
        0 0 30px rgba(0,217,255,.22);
    }

    .timeline-step h3 {
      color: var(--white);
      font-size: .95rem;
    }

    .timeline-step p {
      margin-top: 8px;
      color: #687f9e;
      font-size: .72rem;
    }

    /* =========================================================
       INTEGRATIONS
    ========================================================= */

    .integration-panel {
      position: relative;
      display: grid;
      grid-template-columns: .9fr 1.1fr;
      gap: 80px;
      align-items: center;
      padding: 60px;
      border: 1px solid var(--line);
      border-radius: 32px;
      overflow: hidden;
      background:
        radial-gradient(circle at 80% 20%, rgba(124,58,237,.14), transparent 35%),
        radial-gradient(circle at 20% 80%, rgba(0,217,255,.08), transparent 35%),
        rgba(8,15,33,.7);
      box-shadow: var(--shadow);
    }

    .integration-panel::after {
      content: "";
      position: absolute;
      width: 450px;
      height: 450px;
      right: -200px;
      bottom: -250px;
      border-radius: 50%;
      border: 1px solid rgba(0,217,255,.1);
      box-shadow:
        0 0 0 50px rgba(0,217,255,.025),
        0 0 0 100px rgba(124,58,237,.02);
    }

    .integration-copy h2 {
      color: var(--white);
      font-size: clamp(2.3rem, 4vw, 4rem);
      letter-spacing: -.055em;
      line-height: .98;
    }

    .integration-copy p {
      margin-top: 20px;
      color: var(--muted);
      font-size: .95rem;
    }

    .integration-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }

    .integration {
      position: relative;
      min-height: 105px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid rgba(111,145,195,.15);
      border-radius: 18px;
      background: rgba(255,255,255,.025);
      color: #8fa6c2;
      transition: .3s var(--ease);
    }

    .integration:hover {
      color: var(--white);
      border-color: rgba(0,217,255,.4);
      background: rgba(0,217,255,.05);
      transform: translateY(-4px);
      box-shadow: var(--glow-cyan);
    }

    .integration-logo {
      font-size: 1.5rem;
      font-weight: 900;
    }

    .integration:nth-child(1) .integration-logo {
      color: #29d366;
    }

    .integration:nth-child(2) .integration-logo {
      color: #5da9ff;
    }

    .integration:nth-child(3) .integration-logo {
      color: #9f6cff;
    }

    .integration:nth-child(4) .integration-logo {
      color: #ffbd54;
    }

    .integration:nth-child(5) .integration-logo {
      color: #00d9ff;
    }

    .integration:nth-child(6) .integration-logo {
      color: #a855f7;
    }

    .integration span:last-child {
      font-size: .65rem;
      font-weight: 700;
    }

    /* =========================================================
       METRICS
    ========================================================= */

    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      margin-top: 80px;
      border: 1px solid var(--line);
      border-radius: 24px;
      overflow: hidden;
      background: var(--line);
    }

    .metric {
      min-height: 155px;
      padding: 30px;
      background: #060b18;
    }

    .metric-value {
      color: var(--white);
      font-size: clamp(2rem, 4vw, 3.5rem);
      font-weight: 650;
      letter-spacing: -.06em;
    }

    .metric-value span {
      color: var(--cyan);
    }

    .metric-label {
      margin-top: 5px;
      color: #627a99;
      font-size: .7rem;
      text-transform: uppercase;
      letter-spacing: .1em;
    }

    /* =========================================================
       ROADMAP
    ========================================================= */

    .roadmap {
      position: relative;
      display: grid;
      gap: 14px;
    }

    .roadmap-item {
      display: grid;
      grid-template-columns: 115px 1fr 170px;
      align-items: center;
      gap: 30px;
      padding: 25px 28px;
      border: 1px solid var(--line);
      border-radius: 19px;
      background: rgba(255,255,255,.018);
      transition: .3s ease;
    }

    .roadmap-item:hover {
      border-color: rgba(0,217,255,.28);
      background: rgba(0,217,255,.025);
    }

    .roadmap-date {
      color: #607895;
      font-family: monospace;
      font-size: .68rem;
    }

    .roadmap-title {
      color: var(--white);
      font-size: .92rem;
      font-weight: 750;
    }

    .roadmap-description {
      margin-top: 4px;
      color: #687f9b;
      font-size: .72rem;
    }

    .progress-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .progress {
      flex: 1;
      height: 4px;
      overflow: hidden;
      border-radius: 100px;
      background: rgba(255,255,255,.08);
    }

    .progress-bar {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--cyan), var(--purple));
      box-shadow: 0 0 12px rgba(0,217,255,.5);
      transition: width 1.4s var(--ease);
    }

    .progress-value {
      min-width: 33px;
      color: #8ba1bb;
      font-family: monospace;
      font-size: .63rem;
      text-align: right;
    }

    /* =========================================================
       CTA
    ========================================================= */

    .final-cta {
      position: relative;
      min-height: 560px;
      display: grid;
      place-items: center;
      overflow: hidden;
      text-align: center;
      isolation: isolate;
    }

    .cta-orbit {
      position: absolute;
      width: min(850px, 90vw);
      aspect-ratio: 1;
      border: 1px solid rgba(0,217,255,.12);
      border-radius: 50%;
      transform: rotate(-18deg);
      box-shadow:
        0 0 80px rgba(0,217,255,.04),
        inset 0 0 80px rgba(124,58,237,.04);
      animation: orbitFloat 8s ease-in-out infinite;
    }

    .cta-orbit::before,
    .cta-orbit::after {
      content: "";
      position: absolute;
      inset: 13%;
      border: 1px solid rgba(124,58,237,.12);
      border-radius: 50%;
    }

    .cta-orbit::after {
      inset: 27%;
      border-color: rgba(0,217,255,.12);
    }

    .cta-content {
      position: relative;
      z-index: 2;
      max-width: 850px;
    }

    .cta-content h2 {
      color: white;
      font-size: clamp(3rem, 8vw, 7rem);
      font-weight: 600;
      letter-spacing: -.075em;
      line-height: .88;
    }

    .cta-content h2 span {
      background: linear-gradient(100deg, #fff, var(--cyan), var(--purple));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .cta-content p {
      max-width: 560px;
      margin: 24px auto 0;
      color: #7489a7;
      font-size: 1rem;
    }

    .cta-content .hero-actions {
      opacity: 1;
      transform: none;
      animation: none;
    }

    /* =========================================================
       FOOTER
    ========================================================= */

    footer {
      padding: 35px 0;
      border-top: 1px solid var(--line);
    }

    .footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 25px;
    }

    .footer-copy {
      color: #526984;
      font-size: .68rem;
    }

    .footer-status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #68809c;
      font-family: monospace;
      font-size: .62rem;
      text-transform: uppercase;
      letter-spacing: .08em;
    }

    /* =========================================================
       REVEAL ANIMATIONS
    ========================================================= */

    .reveal {
      opacity: 0;
      transform: translateY(35px);
      transition:
        opacity .9s var(--ease),
        transform .9s var(--ease);
    }

    .reveal.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .reveal-delay-1 { transition-delay: .08s; }
    .reveal-delay-2 { transition-delay: .16s; }
    .reveal-delay-3 { transition-delay: .24s; }
    .reveal-delay-4 { transition-delay: .32s; }
    .reveal-delay-5 { transition-delay: .4s; }

    /* =========================================================
       KEYFRAMES
    ========================================================= */

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes vortexSpin {
      to { transform: rotate(360deg); }
    }

    @keyframes corePulse {
      0%, 100% { transform: scale(.85); opacity: .55; }
      50% { transform: scale(1.15); opacity: 1; }
    }

    @keyframes auraPulse {
      0%, 100% { transform: scale(.88); opacity: .65; }
      50% { transform: scale(1.12); opacity: 1; }
    }

    @keyframes ringSpin {
      to { transform: rotate(360deg); }
    }

    @keyframes floatRobot {
      0%, 100% { transform: translate3d(0, 0, 0); }
      50% { transform: translate3d(0, -12px, 0); }
    }

    @keyframes revealUp {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes robotIn {
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes gradientFlow {
      to { background-position: 220% center; }
    }

    @keyframes statusPulse {
      0%, 100% { opacity: .45; transform: scale(.8); }
      50% { opacity: 1; transform: scale(1.2); }
    }

    @keyframes scrollDown {
      0% { transform: translateY(0); }
      55%, 100% { transform: translateY(300%); }
    }

    @keyframes marquee {
      to { transform: translateX(-50%); }
    }

    @keyframes signalMove {
      0%, 100% { transform: translateX(-40%) rotate(-8deg); opacity: .2; }
      50% { transform: translateX(40%) rotate(-8deg); opacity: 1; }
    }

    @keyframes packetRight {
      from { transform: translateX(0); }
      to { transform: translateX(1000%); }
    }

    @keyframes orbitFloat {
      0%, 100% { transform: rotate(-18deg) scale(.98); }
      50% { transform: rotate(-12deg) scale(1.02); }
    }

    /* =========================================================
       RESPONSIVE
    ========================================================= */

    @media (max-width: 1000px) {
      .nav-links {
        gap: 18px;
        margin-right: 18px;
      }

      .intro-layout,
      .integration-panel {
        grid-template-columns: 1fr;
        gap: 55px;
      }

      .cap-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .architecture {
        grid-template-columns: 1fr;
        gap: 35px;
      }

      .arch-column {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
      }

      .arch-column.center {
        order: -1;
      }

      .arch-agent {
        width: 190px;
        height: 190px;
      }

      .arch-connector {
        display: none;
      }

      .timeline {
        grid-template-columns: repeat(2, 1fr);
        row-gap: 55px;
      }

      .timeline-line,
      .timeline-progress {
        display: none;
      }

      .metrics {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 760px) {
      :root {
        --container: min(100% - 30px, 620px);
        --nav-height: 72px;
      }

      .section {
        padding: 90px 0;
      }

      .nav-links {
        position: fixed;
        top: var(--nav-height);
        left: 15px;
        right: 15px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 3px;
        margin: 0;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(5,5,16,.94);
        backdrop-filter: blur(22px);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: .3s var(--ease);
      }

      .nav-links.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .nav-links a {
        padding: 13px;
        border-radius: 10px;
      }

      .nav-links a:hover {
        background: rgba(0,217,255,.05);
      }

      .nav-cta {
        display: none;
      }

      .menu-toggle {
        display: grid;
        place-items: center;
      }

      .hero {
        padding-top: 90px;
      }

      .hero-title {
        font-size: clamp(3rem, 15vw, 5rem);
      }

      .hero-subtitle {
        font-size: .95rem;
      }

      .hero-actions {
        flex-direction: column;
      }

      .hero-actions .btn {
        width: min(100%, 280px);
      }

      .hero-robot {
        width: min(330px, 78vw);
        height: 330px;
        margin-top: 35px;
      }

      .section-heading {
        margin-bottom: 42px;
      }

      .cap-grid {
        grid-template-columns: 1fr;
      }

      .tilt-card {
        min-height: 230px;
      }

      .architecture-wrap {
        padding: 25px 16px;
      }

      .arch-column {
        grid-template-columns: 1fr;
      }

      .timeline {
        grid-template-columns: 1fr;
        gap: 25px;
        margin-top: 35px;
      }

      .timeline-step {
        display: grid;
        grid-template-columns: 55px 1fr;
        align-items: center;
        text-align: left;
        gap: 17px;
      }

      .timeline-node {
        margin: 0;
      }

      .timeline-step p {
        margin-top: 3px;
      }

      .integration-panel {
        padding: 30px 22px;
      }

      .integration-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .metrics {
        grid-template-columns: 1fr 1fr;
      }

      .metric {
        min-height: 130px;
        padding: 22px;
      }

      .roadmap-item {
        grid-template-columns: 1fr;
        gap: 13px;
      }

      .progress-wrap {
        margin-top: 5px;
      }

      .footer-inner {
        flex-direction: column;
        align-items: flex-start;
      }
    }

    @media (max-width: 430px) {
      .brand-name {
        font-size: .98rem;
      }

      .hero-title {
        font-size: 2.9rem;
      }

      .hero-robot {
        width: 285px;
        height: 285px;
      }

      .metrics {
        grid-template-columns: 1fr;
      }

      .integration-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    /* =========================================================
       REDUCED MOTION
    ========================================================= */

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        animation-duration: .001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .001ms !important;
      }

      .reveal {
        opacity: 1;
        transform: none;
      }

      #particleCanvas {
        display: none;
      }
    }

    /* Keyboard focus */
    :focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 4px;
    }
  </style>
</head>

<body>
  <!-- =======================================================
       LOADER
  ======================================================== -->
  <div class="loader" id="loader" aria-hidden="true">
    <div class="loader-core">
      <span class="loader-label">Initializing X Vortex</span>
    </div>
  </div>

  <!-- =======================================================
       HEADER
  ======================================================== -->
  <header class="site-header" id="siteHeader">
    <div class="container nav">
      <a href="#top" class="brand" aria-label="X Vortex home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-name">X <span>Vortex</span></span>
      </a>

      <nav class="nav-links" id="navLinks" aria-label="Primary navigation">
        <a href="#agent">Agent</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#architecture">Architecture</a>
        <a href="#integrations">Integrations</a>
        <a href="#roadmap">Roadmap</a>
      </nav>

      <a class="nav-cta" href="#contact">Deploy Agent</a>

      <button
        class="menu-toggle"
        id="menuToggle"
        type="button"
        aria-label="Open navigation menu"
        aria-expanded="false"
        aria-controls="navLinks"
      >
        <span></span>
      </button>
    </div>
  </header>

  <main id="top">

    <!-- =====================================================
         HERO
    ====================================================== -->
    <section class="hero" aria-labelledby="hero-title">
      <canvas id="particleCanvas" aria-hidden="true"></canvas>

      <div class="hero-vignette" aria-hidden="true"></div>

      <div class="vortex" aria-hidden="true">
        <div class="vortex-core"></div>
      </div>

      <div class="hero-grid" aria-hidden="true"></div>

      <div class="container">
        <div class="hero-content">

          <div class="hero-kicker">
            <span class="status-dot"></span>
            Autonomous business intelligence
          </div>

          <h1 class="hero-title" id="hero-title">
            The AI Operating Layer
            <span class="gradient">for Modern Businesses.</span>
          </h1>

          <p class="hero-subtitle">
            Understand customers. Automate conversations. Take action.
          </p>

          <div class="hero-actions">
            <a class="btn btn-primary" href="#agent">
              Explore X Vortex
              <span aria-hidden="true">↗</span>
            </a>

            <a class="btn btn-secondary" href="#architecture">
              View Architecture
              <span aria-hidden="true">⌁</span>
            </a>
          </div>

          <div class="hero-robot" id="heroRobot" aria-label="X Vortex AI robot">
            <div class="robot-aura"></div>
            <div class="robot-ring"></div>

            <div class="robot-image-wrap" id="robotParallax">
              <!-- Supply the provided artwork as ./x-vortex-robot.png -->
              <img
                class="robot-image"
                id="robotArtwork"
                src="./x-vortex-robot.png"
                alt="X Vortex futuristic AI robot"
              />

              <!-- Inline fallback keeps the page complete if the supplied artwork is unavailable -->
              <svg
                class="robot-fallback"
                id="robotFallback"
                viewBox="0 0 300 300"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="robotMetal" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#dffaff"/>
                    <stop offset=".28" stop-color="#456681"/>
                    <stop offset=".55" stop-color="#111d31"/>
                    <stop offset="1" stop-color="#050913"/>
                  </linearGradient>

                  <linearGradient id="robotPurple" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#00eaff"/>
                    <stop offset=".5" stop-color="#2563ff"/>
                    <stop offset="1" stop-color="#a855f7"/>
                  </linearGradient>

                  <filter id="robotGlow">
                    <feGaussianBlur stdDeviation="5" result="blur"/>
                    <feMerge>
                      <feMergeNode in="blur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>

                  <filter id="strongRobotGlow">
                    <feGaussianBlur stdDeviation="11" result="blur"/>
                    <feMerge>
                      <feMergeNode in="blur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>

                <ellipse
                  cx="150"
                  cy="270"
                  rx="72"
                  ry="11"
                  fill="#00d9ff"
                  opacity=".12"
                  filter="url(#strongRobotGlow)"
                />

                <!-- shoulders -->
                <path
                  d="M74 148 Q46 150 39 177 L65 196 91 181Z"
                  fill="#111c2e"
                  stroke="#00d9ff"
                  stroke-opacity=".35"
                />
                <path
                  d="M226 148 Q254 150 261 177 L235 196 209 181Z"
                  fill="#111c2e"
                  stroke="#7c3aed"
                  stroke-opacity=".4"
                />

                <!-- torso -->
                <path
                  d="M91 139 Q150 118 209 139 L223 228 Q150 263 77 228Z"
                  fill="url(#robotMetal)"
                  stroke="#4b8ca8"
                  stroke-width="1.5"
                />

                <path
                  d="M106 155 Q150 139 194 155 L188 211 Q150 229 112 211Z"
                  fill="#081321"
                  stroke="url(#robotPurple)"
                  stroke-width="2"
                />

                <!-- chest core -->
                <circle
                  cx="150"
                  cy="183"
                  r="25"
                  fill="#00d9ff"
                  opacity=".14"
                  filter="url(#strongRobotGlow)"
                />
                <circle
                  cx="150"
                  cy="183"
                  r="15"
                  fill="#07101f"
                  stroke="#00eaff"
                  stroke-width="2"
                  filter="url(#robotGlow)"
                />
                <circle
                  cx="150"
                  cy="183"
                  r="7"
                  fill="#dffcff"
                  filter="url(#strongRobotGlow)"
                />

                <!-- neck -->
                <path
                  d="M128 133 L134 110 H166 L172 133Z"
                  fill="#0a1424"
                  stroke="#426a82"
                />

                <!-- head -->
                <path
                  d="M102 62 Q106 28 150 25 Q194 28 198 62 L190 111 Q175 137 150 139 Q125 137 110 111Z"
                  fill="url(#robotMetal)"
                  stroke="#7da5bb"
                  stroke-width="1.5"
                />

                <!-- helmet -->
                <path
                  d="M107 66 Q114 31 150 30 Q186 31 193 66 L183 78 Q150 66 117 78Z"
                  fill="#0a1527"
                />

                <!-- visor -->
                <path
                  d="M116 72 Q150 60 184 72 L177 97 Q150 109 123 97Z"
                  fill="#030a15"
                  stroke="#00d9ff"
                  stroke-opacity=".65"
                />

                <path
                  d="M127 82 L143 78"
                  stroke="#00eaff"
                  stroke-width="4"
                  stroke-linecap="round"
                  filter="url(#robotGlow)"
                />
                <path
                  d="M157 78 L173 82"
                  stroke="#a855f7"
                  stroke-width="4"
                  stroke-linecap="round"
                  filter="url(#robotGlow)"
                />

                <!-- side sensors -->
                <circle
                  cx="105"
                  cy="78"
                  r="9"
                  fill="#07111e"
                  stroke="#00d9ff"
                />
                <circle
                  cx="195"
                  cy="78"
                  r="9"
                  fill="#07111e"
                  stroke="#a855f7"
                />

                <!-- arms -->
                <path
                  d="M76 169 L51 211 L72 224 L105 183Z"
                  fill="#16253a"
                  stroke="#426a82"
                />
                <path
                  d="M224 169 L249 211 L228 224 L195 183Z"
                  fill="#16253a"
                  stroke="#65548f"
                />

                <!-- hands -->
                <circle cx="62" cy="221" r="11" fill="#081220" stroke="#00d9ff"/>
                <circle cx="238" cy="221" r="11" fill="#081220" stroke="#a855f7"/>

                <!-- waist -->
                <path
                  d="M106 222 Q150 240 194 222 L185 242 Q150 255 115 242Z"
                  fill="#0b1727"
                  stroke="#31506b"
                />

                <!-- legs -->
                <path
                  d="M113 238 L145 241 L139 276 L108 276Z"
                  fill="#15253a"
                  stroke="#426a82"
                />
                <path
                  d="M155 241 L187 238 L192 276 L161 276Z"
                  fill="#15253a"
                  stroke="#65548f"
                />

                <!-- feet -->
                <path
                  d="M107 273 H142 L135 283 H100Z"
                  fill="#08111e"
                  stroke="#00d9ff"
                />
                <path
                  d="M158 273 H193 L200 283 H165Z"
                  fill="#08111e"
                  stroke="#a855f7"
                />

                <!-- circuitry -->
                <path
                  d="M96 160 L84 176 M204 160 L216 176 M122 220 L117 238 M178 220 L183 238"
                  stroke="#00d9ff"
                  stroke-opacity=".7"
                  stroke-width="1.5"
                  filter="url(#robotGlow)"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div class="hero-scroll" aria-hidden="true">
        <span class="scroll-line"></span>
        Scroll to enter the vortex
      </div>
    </section>

    <!-- =====================================================
         MARQUEE
    ====================================================== -->
    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        <div class="marquee-item">
          <b>✦</b> Reasoning Engine
          <b>✦</b> Autonomous Workflows
          <b>✦</b> Customer Intelligence
          <b>✦</b> Real-Time Actions
          <b>✦</b> Knowledge Graph
          <b>✦</b> Tool Orchestration
        </div>
        <div class="marquee-item">
          <b>✦</b> Reasoning Engine
          <b>✦</b> Autonomous Workflows
          <b>✦</b> Customer Intelligence
          <b>✦</b> Real-Time Actions
          <b>✦</b> Knowledge Graph
          <b>✦</b> Tool Orchestration
        </div>
      </div>
    </div>

    <!-- =====================================================
         INTRO
    ====================================================== -->
    <section class="section" id="agent" aria-labelledby="agent-title">
      <div class="container intro-layout">

        <div class="intro-copy reveal">
          <span class="eyebrow">01 / The Agent</span>

          <h2 id="agent-title">
            One intelligence layer.
            <span>Infinite actions.</span>
          </h2>

          <p>
            X Vortex connects your customers, company knowledge, business
            systems and workflows into one continuously operating AI agent.
            It does more than answer questions — it understands context,
            decides what should happen next, and executes.
          </p>

          <div class="hero-actions" style="justify-content:flex-start; opacity:1; transform:none; animation:none;">
            <a class="btn btn-secondary" href="#architecture">
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        <div class="terminal reveal reveal-delay-2" aria-label="X Vortex agent system visualization">
          <div class="terminal-inner">
            <div class="terminal-top">
              <span class="terminal-dot"></span>
              <span class="terminal-dot"></span>
              <span class="terminal-dot"></span>
              <span class="terminal-title">XVORTEX / AGENT.RUNTIME</span>
            </div>

            <div class="terminal-code">
              <div><span class="violet">agent</span>.<span class="cyan">observe</span>(customer_context)</div>
              <div><span class="violet">knowledge</span>.<span class="cyan">retrieve</span>(intent)</div>
              <div><span class="violet">reason</span>.<span class="cyan">plan</span>(next_best_action)</div>
              <div><span class="violet">tools</span>.<span class="cyan">execute</span>(workflow)</div>
              <div><span class="violet">channel</span>.<span class="cyan">respond</span>(personalized_reply)</div>
              <br />
              <div><span class="green">✓</span> context synchronized</div>
              <div><span class="green">✓</span> knowledge grounded</div>
              <div><span class="green">✓</span> action authorized</div>
              <div><span class="white">→ outcome delivered</span></div>
            </div>

            <div class="terminal-signal" aria-hidden="true">
              <span class="signal-line"></span>
              <span class="signal-line"></span>
              <span class="signal-line"></span>
              <div class="signal-wave"></div>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- =====================================================
         CAPABILITIES
    ====================================================== -->
    <section class="section capabilities" id="capabilities" aria-labelledby="capabilities-title">
      <div class="container">

        <div class="section-heading reveal">
          <span class="eyebrow">02 / Core capabilities</span>
          <h2 id="capabilities-title">
            Built to <span>think, communicate</span> and execute.
          </h2>
          <p>
            A modular intelligence stack designed around the complete business
            loop — from understanding information to taking measurable action.
          </p>
        </div>

        <div class="cap-grid">

          <article class="tilt-card reveal">
            <span class="cap-index">01</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 4h14v16H5z"/>
                <path d="M8 8h8M8 12h6M8 16h4"/>
              </svg>
            </div>
            <h3>Knowledge</h3>
            <p>
              Ground responses in your documents, policies, products,
              processes and continuously evolving business knowledge.
            </p>
          </article>

          <article class="tilt-card reveal reveal-delay-1">
            <span class="cap-index">02</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="8"/>
                <path d="M12 8v4l3 2"/>
              </svg>
            </div>
            <h3>Intelligence</h3>
            <p>
              Interpret intent, maintain context, reason over information and
              choose the appropriate next step dynamically.
            </p>
          </article>

          <article class="tilt-card reveal reveal-delay-2">
            <span class="cap-index">03</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 5h16v11H8l-4 4z"/>
                <path d="M8 9h8M8 12h5"/>
              </svg>
            </div>
            <h3>Communication</h3>
            <p>
              Deliver natural, context-aware conversations across the channels
              your customers already use.
            </p>
          </article>

          <article class="tilt-card reveal reveal-delay-3">
            <span class="cap-index">04</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 3v18M3 12h18"/>
                <circle cx="12" cy="12" r="7"/>
              </svg>
            </div>
            <h3>Automation</h3>
            <p>
              Convert conversations into repeatable workflows with triggers,
              conditions, approvals and autonomous execution.
            </p>
          </article>

          <article class="tilt-card reveal reveal-delay-4">
            <span class="cap-index">05</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 8h8v8H8z"/>
                <path d="M4 4h4M16 4h4M4 20h4M16 20h4"/>
                <path d="M4 4v4M20 4v4M4 20v-4M20 20v-4"/>
              </svg>
            </div>
            <h3>Tools</h3>
            <p>
              Connect APIs, CRM systems, databases and internal services so
              the agent can perform real work.
            </p>
          </article>

          <article class="tilt-card reveal reveal-delay-5">
            <span class="cap-index">06</span>
            <div class="cap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 19V5M4 19h16"/>
                <path d="M7 15l3-4 3 2 5-7"/>
              </svg>
            </div>
            <h3>Analytics</h3>
            <p>
              Observe conversations, actions and outcomes through a living
              operational intelligence layer.
            </p>
          </article>

        </div>
      </div>
    </section>

    <!-- =====================================================
         ARCHITECTURE
    ====================================================== -->
    <section class="section" id="architecture" aria-labelledby="architecture-title">
      <div class="container">

        <div class="section-heading reveal">
          <span class="eyebrow">03 / System architecture</span>
          <h2 id="architecture-title">
            From customer signal to
            <span>business outcome.</span>
          </h2>
          <p>
            X Vortex sits between the customer and the systems that make your
            business run, turning fragmented interactions into coordinated action.
          </p>
        </div>

        <div class="architecture-wrap reveal">

          <div class="architecture">

            <div class="arch-column">
              <button class="arch-node active" type="button" data-arch="customer">
                <strong>Customer</strong>
                <small>Intent · Context · Signal</small>
                <span class="node-icon">01</span>
              </button>

              <button class="arch-node" type="button" data-arch="channels">
                <strong>Channels</strong>
                <small>WhatsApp · Web · Voice · Email</small>
                <span class="node-icon">02</span>
              </button>
            </div>

            <div class="arch-column center">
              <div class="arch-agent">
                <div class="agent-inner">
                  <div class="agent-logo">X</div>
                  <strong>X Vortex</strong>
                  <span>AI Agent Core</span>
                </div>
              </div>
            </div>

            <div class="arch-column">
              <button class="arch-node" type="button" data-arch="knowledge">
                <strong>Knowledge</strong>
                <small>RAG · Memory · Policies</small>
                <span class="node-icon">03</span>
              </button>

              <button class="arch-node" type="button" data-arch="tools">
                <strong>Tools + Workflows</strong>
                <small>CRM · APIs · Automation</small>
                <span class="node-icon">04</span>
              </button>

              <div class="arch-outcome">
                <strong>Business Outcome</strong>
                <p>Resolve · Convert · Retain · Automate</p>
              </div>
            </div>

            <div class="arch-connector connector-left" aria-hidden="true">
              <span class="data-packet"></span>
            </div>

            <div class="arch-connector connector-right" aria-hidden="true">
              <span class="data-packet"></span>
            </div>

          </div>

          <div class="architecture-detail" id="architectureDetail">
            <strong>Customer signal detected.</strong>
            X Vortex continuously maps intent to context, knowledge and action.
          </div>
        </div>
      </div>
    </section>

    <!-- =====================================================
         TIMELINE
    ====================================================== -->
    <section class="section" aria-labelledby="timeline-title">
      <div class="container">

        <div class="section-heading reveal">
          <span class="eyebrow">04 / The operating loop</span>
          <h2 id="timeline-title">
            Conversation becomes
            <span>execution.</span>
          </h2>
        </div>

        <div class="timeline reveal" id="timeline">

          <div class="timeline-line"></div>
          <div class="timeline-progress" id="timelineProgress"></div>

          <article class="timeline-step active">
            <div class="timeline-node">01</div>
            <div>
              <h3>Conversation</h3>
              <p>Capture what the customer actually needs.</p>
            </div>
          </article>

          <article class="timeline-step">
            <div class="timeline-node">02</div>
            <div>
              <h3>Knowledge</h3>
              <p>Ground the response in trusted business context.</p>
            </div>
          </article>

          <article class="timeline-step">
            <div class="timeline-node">03</div>
            <div>
              <h3>Action</h3>
              <p>Select and execute the appropriate operation.</p>
            </div>
          </article>

          <article class="timeline-step">
            <div class="timeline-node">04</div>
            <div>
              <h3>Automation</h3>
              <p>Turn successful actions into repeatable systems.</p>
            </div>
          </article>

        </div>
      </div>
    </section>

    <!-- =====================================================
         INTEGRATIONS
    ====================================================== -->
    <section class="section" id="integrations" aria-labelledby="integrations-title">
      <div class="container">

        <div class="integration-panel reveal">

          <div class="integration-copy">
            <span class="eyebrow">05 / Ecosystem</span>

            <h2 id="integrations-title">
              Your stack.
              <br />
              <span style="color:var(--cyan)">One intelligence layer.</span>
            </h2>

            <p>
              Meet customers where they already are and connect the systems
              your teams already depend on. X Vortex becomes the orchestration
              layer between conversation and execution.
            </p>

            <div class="hero-actions" style="justify-content:flex-start; opacity:1; transform:none; animation:none;">
              <a class="btn btn-primary" href="#contact">
                Connect your stack <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>

          <div class="integration-grid" aria-label="Integration ecosystem">

            <div class="integration">
              <span class="integration-logo">◉</span>
              <span>WhatsApp</span>
            </div>

            <div class="integration">
              <span class="integration-logo">◌</span>
              <span>Web Chat</span>
            </div>

            <div class="integration">
              <span class="integration-logo">✉</span>
              <span>Email</span>
            </div>

            <div class="integration">
              <span class="integration-logo">◆</span>
              <span>CRM</span>
            </div>

            <div class="integration">
              <span class="integration-logo">⌁</span>
              <span>APIs</span>
            </div>

            <div class="integration">
              <span class="integration-logo">✦</span>
              <span>Custom Tools</span>
            </div>

          </div>
        </div>

        <div class="metrics reveal">

          <div class="metric">
            <div class="metric-value">
              <span data-counter="24">0</span>/7
            </div>
            <div class="metric-label">Operational availability</div>
          </div>

          <div class="metric">
            <div class="metric-value">
              <span data-counter="6">0</span>
            </div>
            <div class="metric-label">Core intelligence layers</div>
          </div>

          <div class="metric">
            <div class="metric-value">
              <span data-counter="360">0</span>°
            </div>
            <div class="metric-label">Customer context</div>
          </div>

          <div class="metric">
            <div class="metric-value">
              <span data-counter="1">0</span>
            </div>
            <div class="metric-label">Operating layer</div>
          </div>

        </div>

      </div>
    </section>

    <!-- =====================================================
         ROADMAP
    ====================================================== -->
    <section class="section" id="roadmap" aria-labelledby="roadmap-title">
      <div class="container">

        <div class="section-heading reveal">
          <span class="eyebrow">06 / Roadmap</span>
          <h2 id="roadmap-title">
            Intelligence that
            <span>keeps evolving.</span>
          </h2>
          <p>
            A continuously expanding agent platform — designed around deeper
            context, broader actions and increasingly autonomous operations.
          </p>
        </div>

        <div class="roadmap">

          <article class="roadmap-item reveal">
            <div class="roadmap-date">PHASE / 01</div>

            <div>
              <div class="roadmap-title">Conversational Intelligence</div>
              <div class="roadmap-description">
                Context-aware conversations across customer touchpoints.
              </div>
            </div>

            <div class="progress-wrap">
              <div class="progress">
                <div class="progress-bar" data-progress="92"></div>
              </div>
              <span class="progress-value">92%</span>
            </div>
          </article>

          <article class="roadmap-item reveal reveal-delay-1">
            <div class="roadmap-date">PHASE / 02</div>

            <div>
              <div class="roadmap-title">Business Memory</div>
              <div class="roadmap-description">
                Persistent organizational context and knowledge evolution.
              </div>
            </div>

            <div class="progress-wrap">
              <div class="progress">
                <div class="progress-bar" data-progress="78"></div>
              </div>
              <span class="progress-value">78%</span>
            </div>
          </article>

          <article class="roadmap-item reveal reveal-delay-2">
            <div class="roadmap-date">PHASE / 03</div>

            <div>
              <div class="roadmap-title">Agentic Workflows</div>
              <div class="roadmap-description">
                Multi-step planning, tools and autonomous execution.
              </div>
            </div>

            <div class="progress-wrap">
              <div class="progress">
                <div class="progress-bar" data-progress="61"></div>
              </div>
              <span class="progress-value">61%</span>
            </div>
          </article>

          <article class="roadmap-item reveal reveal-delay-3">
            <div class="roadmap-date">PHASE / 04</div>

            <div>
              <div class="roadmap-title">Autonomous Operations</div>
              <div class="roadmap-description">
                Coordinated agents operating across the business stack.
              </div>
            </div>

            <div class="progress-wrap">
              <div class="progress">
                <div class="progress-bar" data-progress="38"></div>
              </div>
              <span class="progress-value">38%</span>
            </div>
          </article>

        </div>
      </div>
    </section>

    <!-- =====================================================
         FINAL CTA
    ====================================================== -->
    <section class="final-cta" id="contact" aria-labelledby="cta-title">

      <div class="cta-orbit" aria-hidden="true"></div>

      <div class="cta-content reveal">
        <span class="eyebrow">07 / Enter the vortex</span>

        <h2 id="cta-title">
          Let your business
          <span>think in motion.</span>
        </h2>

        <p>
          Build a business where every conversation can become intelligence,
          every insight can become action, and every action can become an
          automated system.
        </p>

        <div class="hero-actions">
          <a class="btn btn-primary" href="mailto:hello@xvortex.ai">
            Explore X Vortex <span aria-hidden="true">↗</span>
          </a>

          <a class="btn btn-secondary" href="#architecture">
            View architecture <span aria-hidden="true">⌁</span>
          </a>
        </div>
      </div>
    </section>

  </main>

  <!-- =======================================================
       FOOTER
  ======================================================== -->
  <footer>
    <div class="container footer-inner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-name">X <span>Vortex</span></span>
      </div>

      <div class="footer-copy">
        © 2026 X Vortex. Intelligence infrastructure for modern business.
      </div>

      <div class="footer-status">
        <span class="status-dot"></span>
        Systems nominal
      </div>
    </div>
  </footer>

  <script>
    /* =========================================================
       X VORTEX — VANILLA JAVASCRIPT
    ========================================================= */

    (() => {
      "use strict";

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      const $ = (selector, parent = document) =>
        parent.querySelector(selector);

      const $$ = (selector, parent = document) =>
        [...parent.querySelectorAll(selector)];

      /* -------------------------------------------------------
         LOADER
      ------------------------------------------------------- */

      const loader = $("#loader");

      window.addEventListener("load", () => {
        window.setTimeout(() => {
          loader.classList.add("is-done");
        }, reducedMotion ? 0 : 650);
      });

      /* -------------------------------------------------------
         HEADER
      ------------------------------------------------------- */

      const header = $("#siteHeader");

      const updateHeader = () => {
        header.classList.toggle("scrolled", window.scrollY > 30);
      };

      updateHeader();
      window.addEventListener("scroll", updateHeader, { passive: true });

      /* -------------------------------------------------------
         MOBILE NAVIGATION
      ------------------------------------------------------- */

      const menuToggle = $("#menuToggle");
      const navLinks = $("#navLinks");

      const closeMenu = () => {
        navLinks.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation menu");
      };

      menuToggle.addEventListener("click", () => {
        const open = navLinks.classList.toggle("open");

        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute(
          "aria-label",
          open ? "Close navigation menu" : "Open navigation menu"
        );
      });

      $$(".nav-links a").forEach((link) => {
        link.addEventListener("click", closeMenu);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMenu();
        }
      });

      /* -------------------------------------------------------
         ROBOT ARTWORK FALLBACK
      ------------------------------------------------------- */

      const artwork = $("#robotArtwork");
      const fallback = $("#robotFallback");

      const showFallback = () => {
        artwork.style.display = "none";
        fallback.style.display = "block";
      };

      fallback.style.display = "none";

      artwork.addEventListener("error", showFallback);

      if (artwork.complete && artwork.naturalWidth === 0) {
        showFallback();
      }

      /* -------------------------------------------------------
         SMOOTH INTERNAL LINKS
      ------------------------------------------------------- */

      $$('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
          const targetId = link.getAttribute("href");

          if (!targetId || targetId === "#") {
            return;
          }

          const target = $(targetId);

          if (!target) {
            return;
          }

          event.preventDefault();

          target.scrollIntoView({
            behavior: reducedMotion ? "auto" : "smooth",
            block: "start"
          });
        });
      });

      /* -------------------------------------------------------
         INTERSECTION OBSERVER
      ------------------------------------------------------- */

      const revealElements = $$(".reveal");

      if (!reducedMotion && "IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }

              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            });
          },
          {
            threshold: 0.12,
            rootMargin: "0px 0px -50px 0px"
          }
        );

        revealElements.forEach((element) => {
          revealObserver.observe(element);
        });
      } else {
        revealElements.forEach((element) => {
          element.classList.add("is-visible");
        });
      }

      /* -------------------------------------------------------
         MOUSE FOLLOWING HERO PARALLAX
      ------------------------------------------------------- */

      const hero = $(".hero");
      const robotParallax = $("#robotParallax");
      const vortex = $(".vortex");

      let pointerX = 0;
      let pointerY = 0;
      let currentX = 0;
      let currentY = 0;
      let parallaxFrame = null;

      const updateParallax = () => {
        currentX += (pointerX - currentX) * 0.075;
        currentY += (pointerY - currentY) * 0.075;

        const rotateY = currentX * 7;
        const rotateX = -currentY * 5;

        if (!reducedMotion) {
          robotParallax.style.transform =
            `translate3d(${currentX * 9}px, ${currentY * 9}px, 0)
             rotateX(${rotateX}deg)
             rotateY(${rotateY}deg)`;

          vortex.style.transform =
            `translate(calc(-50% + ${currentX * -14}px), calc(-50% + ${currentY * -10}px))`;
        }

        parallaxFrame = requestAnimationFrame(updateParallax);
      };

      hero.addEventListener("pointermove", (event) => {
        if (reducedMotion) {
          return;
        }

        const rect = hero.getBoundingClientRect();

        pointerX = ((event.clientX - rect.left) / rect.width - 0.5);
        pointerY = ((event.clientY - rect.top) / rect.height - 0.5);
      });

      hero.addEventListener("pointerleave", () => {
        pointerX = 0;
        pointerY = 0;
      });

      if (!reducedMotion) {
        parallaxFrame = requestAnimationFrame(updateParallax);
      }

      /* -------------------------------------------------------
         3D CARD TILT
      ------------------------------------------------------- */

      const cards = $$(".tilt-card");

      cards.forEach((card) => {
        card.addEventListener("pointermove", (event) => {
          if (reducedMotion || window.innerWidth < 760) {
            return;
          }

          const rect = card.getBoundingClientRect();

          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;

          const rotateX = (0.5 - y) * 7;
          const rotateY = (x - 0.5) * 7;

          card.style.setProperty("--mx", `${x * 100}%`);
          card.style.setProperty("--my", `${y * 100}%`);

          card.style.transform =
            `perspective(800px)
             rotateX(${rotateX}deg)
             rotateY(${rotateY}deg)
             translateY(-4px)`;
        });

        card.addEventListener("pointerleave", () => {
          card.style.transform = "";
          card.style.setProperty("--mx", "50%");
          card.style.setProperty("--my", "50%");
        });
      });

      /* -------------------------------------------------------
         PARTICLE FIELD
      ------------------------------------------------------- */

      const canvas = $("#particleCanvas");
      const ctx = canvas.getContext("2d", { alpha: true });

      const particles = [];
      let particleWidth = 0;
      let particleHeight = 0;
      let particleDpr = 1;
      let particleFrame = null;

      const particleConfig = {
        count: 100,
        minRadius: 0.35,
        maxRadius: 1.5,
        minSpeed: 0.05,
        maxSpeed: 0.28
      };

      const randomBetween = (min, max) =>
        Math.random() * (max - min) + min;

      const resizeCanvas = () => {
        const rect = canvas.getBoundingClientRect();

        particleWidth = rect.width;
        particleHeight = rect.height;
        particleDpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = particleWidth * particleDpr;
        canvas.height = particleHeight * particleDpr;

        ctx.setTransform(
          particleDpr,
          0,
          0,
          particleDpr,
          0,
          0
        );
      };

      const createParticle = () => ({
        x: randomBetween(0, particleWidth),
        y: randomBetween(0, particleHeight),
        radius: randomBetween(
          particleConfig.minRadius,
          particleConfig.maxRadius
        ),
        speed: randomBetween(
          particleConfig.minSpeed,
          particleConfig.maxSpeed
        ),
        opacity: randomBetween(.18, .8),
        phase: randomBetween(0, Math.PI * 2),
        hue: Math.random() > .82 ? "violet" : "cyan"
      });

      const seedParticles = () => {
        particles.length = 0;

        const count = Math.min(
          particleConfig.count,
          Math.max(50, Math.floor(particleWidth / 11))
        );

        for (let i = 0; i < count; i += 1) {
          particles.push(createParticle());
        }
      };

      const drawParticles = (time) => {
        ctx.clearRect(0, 0, particleWidth, particleHeight);

        particles.forEach((particle) => {
          if (!reducedMotion) {
            particle.y -= particle.speed;

            if (particle.y < -5) {
              particle.y = particleHeight + 5;
              particle.x = randomBetween(0, particleWidth);
            }
          }

          const twinkle =
            particle.opacity *
            (0.72 + Math.sin(time * 0.0015 + particle.phase) * 0.28);

          const color =
            particle.hue === "violet"
              ? `rgba(168,85,247,${twinkle})`
              : `rgba(0,217,255,${twinkle})`;

          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.arc(
            particle.x,
            particle.y,
            particle.radius,
            0,
            Math.PI * 2
          );
          ctx.fill();
        });

        if (!reducedMotion) {
          particleFrame = requestAnimationFrame(drawParticles);
        }
      };

      resizeCanvas();
      seedParticles();

      window.addEventListener("resize", () => {
        resizeCanvas();
        seedParticles();
      });

      if (!reducedMotion) {
        particleFrame = requestAnimationFrame(drawParticles);
      } else {
        drawParticles(0);
      }

      /* -------------------------------------------------------
         ARCHITECTURE INTERACTION
      ------------------------------------------------------- */

      const architectureDetail = $("#architectureDetail");

      const architectureMessages = {
        customer:
          "<strong>Customer signal detected.</strong> X Vortex receives intent, context and conversation history.",
        channels:
          "<strong>Channel synchronized.</strong> The same intelligence can operate across WhatsApp, web, email and other touchpoints.",
        knowledge:
          "<strong>Knowledge grounded.</strong> The agent retrieves relevant business context before producing an answer or action.",
        tools:
          "<strong>Action selected.</strong> X Vortex can coordinate APIs, CRM operations and multi-step workflows."
      };

      const archNodes = $$(".arch-node");

      archNodes.forEach((node) => {
        node.addEventListener("click", () => {
          archNodes.forEach((item) => item.classList.remove("active"));
          node.classList.add("active");

          const key = node.dataset.arch;
          architectureDetail.innerHTML =
            architectureMessages[key] || architectureMessages.customer;
        });
      });

      /* -------------------------------------------------------
         TIMELINE AUTOPLAY
      ------------------------------------------------------- */

      const timelineSteps = $$(".timeline-step");
      const timelineProgress = $("#timelineProgress");
      let activeTimeline = 0;
      let timelineTimer = null;

      const activateTimeline = (index) => {
        timelineSteps.forEach((step, stepIndex) => {
          step.classList.toggle("active", stepIndex === index);
        });

        if (!reducedMotion) {
          const progress =
            index / Math.max(1, timelineSteps.length - 1);

          timelineProgress.style.width = `${progress * 76}%`;
        }
      };

      timelineSteps.forEach((step, index) => {
        step.addEventListener("mouseenter", () => {
          activateTimeline(index);
        });

        step.addEventListener("focusin", () => {
          activateTimeline(index);
        });
      });

      const startTimeline = () => {
        if (reducedMotion) {
          return;
        }

        timelineTimer = window.setInterval(() => {
          activeTimeline =
            (activeTimeline + 1) % timelineSteps.length;

          activateTimeline(activeTimeline);
        }, 2300);
      };

      startTimeline();

      /* -------------------------------------------------------
         COUNTERS
      ------------------------------------------------------- */

      const counters = $$("[data-counter]");
      const counterValues = new WeakMap();

      const animateCounter = (element) => {
        const target = Number(element.dataset.counter);

        if (!Number.isFinite(target)) {
          return;
        }

        if (reducedMotion) {
          element.textContent = String(target);
          return;
        }

        const duration = 1200;
        const startTime = performance.now();

        const update = (currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          const eased = 1 - Math.pow(1 - progress, 3);
          const value = Math.round(target * eased);

          element.textContent = String(value);

          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            element.textContent = String(target);
          }
        };

        requestAnimationFrame(update);
      };

      if ("IntersectionObserver" in window) {
        const counterObserver = new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }

              if (!counterValues.has(entry.target)) {
                counterValues.set(entry.target, true);
                animateCounter(entry.target);
              }

              observer.unobserve(entry.target);
            });
          },
          { threshold: .6 }
        );

        counters.forEach((counter) => {
          counterObserver.observe(counter);
        });
      } else {
        counters.forEach(animateCounter);
      }

      /* -------------------------------------------------------
         ROADMAP PROGRESS
      ------------------------------------------------------- */

      const progressBars = $$(".progress-bar");

      const animateProgressBars = () => {
        progressBars.forEach((bar) => {
          const target = Number(bar.dataset.progress);

          if (Number.isFinite(target)) {
            bar.style.width = `${target}%`;
          }
        });
      };

      if ("IntersectionObserver" in window) {
        const progressObserver = new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }

              animateProgressBars();
              observer.disconnect();
            });
          },
          { threshold: .25 }
        );

        const roadmap = $(".roadmap");

        if (roadmap) {
          progressObserver.observe(roadmap);
        }
      } else {
        animateProgressBars();
      }

      /* -------------------------------------------------------
         PAUSE HEAVY EFFECTS WHEN TAB IS HIDDEN
      ------------------------------------------------------- */

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (particleFrame) {
            cancelAnimationFrame(particleFrame);
            particleFrame = null;
          }

          if (parallaxFrame) {
            cancelAnimationFrame(parallaxFrame);
            parallaxFrame = null;
          }

          if (timelineTimer) {
            clearInterval(timelineTimer);
            timelineTimer = null;
          }

          return;
        }

        if (!reducedMotion && !particleFrame) {
          particleFrame = requestAnimationFrame(drawParticles);
        }

        if (!reducedMotion && !parallaxFrame) {
          parallaxFrame = requestAnimationFrame(updateParallax);
        }

        if (!reducedMotion && !timelineTimer) {
          startTimeline();
        }
      });

      /* -------------------------------------------------------
         CLEANUP
      ------------------------------------------------------- */

      window.addEventListener("beforeunload", () => {
        if (particleFrame) {
          cancelAnimationFrame(particleFrame);
        }

        if (parallaxFrame) {
          cancelAnimationFrame(parallaxFrame);
        }

        if (timelineTimer) {
          clearInterval(timelineTimer);
        }
      });
    })();
  </script>
</body>
</html>