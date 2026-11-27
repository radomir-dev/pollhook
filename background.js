(function initBackground() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas || window.location.search.includes("record")) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let nodes = [];
  let pulses = [];
  let ripples = [];
  let animId = null;
  let lastPulseTime = 0;

  const pointer = { x: -9999, y: -9999, active: false };
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(48, Math.max(14, Math.floor((width * height) / 28000)));
    nodes = [];

    for (let i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1.5 + Math.random() * 1.2,
        alpha: 0.18 + Math.random() * 0.15,
      });
    }
  }

  function addRipple(x, y) {
    if (ripples.length > 5) ripples.shift();
    ripples.push({ x, y, r: 0, maxR: 80, alpha: 0.35 });
  }

  function triggerLinkPulse() {
    if (nodes.length < 2) return;
    const candidates = [];
    const maxDist = 130;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (Math.hypot(dx, dy) < maxDist) {
          candidates.push([nodes[i], nodes[j]]);
        }
      }
    }

    if (candidates.length > 0) {
      const pair = candidates[Math.floor(Math.random() * candidates.length)];
      pulses.push({ from: pair[0], to: pair[1], t: 0, speed: 0.016 });
    }
  }

  function drawFrame(staticOnly) {
    ctx.clearRect(0, 0, width, height);
    const maxDist = 130;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!staticOnly) {
        a.x += a.vx;
        a.y += a.vy;

        if (a.x < 0 || a.x > width) a.vx *= -1;
        if (a.y < 0 || a.y > height) a.vy *= -1;

        if (pointer.active) {
          const dx = a.x - pointer.x;
          const dy = a.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 110 && dist > 0) {
            const force = (1 - dist / 110) * 0.6;
            a.x += (dx / dist) * force;
            a.y += (dy / dist) * force;
          }
        }
      }

      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56, 189, 248, ${a.alpha})`;
      ctx.fill();

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);

        if (dist < maxDist) {
          const lineAlpha = (1 - dist / maxDist) * 0.12;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(56, 189, 248, ${lineAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    if (staticOnly) return;

    for (let p = pulses.length - 1; p >= 0; p--) {
      const pulse = pulses[p];
      pulse.t += pulse.speed;
      if (pulse.t >= 1) {
        pulses.splice(p, 1);
        continue;
      }

      const px = pulse.from.x + (pulse.to.x - pulse.from.x) * pulse.t;
      const py = pulse.from.y + (pulse.to.y - pulse.from.y) * pulse.t;
      const pAlpha = Math.sin(pulse.t * Math.PI) * 0.35;

      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${pAlpha})`;
      ctx.fill();
    }

    for (let r = ripples.length - 1; r >= 0; r--) {
      const rip = ripples[r];
      rip.r += 1.8;
      const fade = (1 - rip.r / rip.maxR) * rip.alpha;

      if (rip.r >= rip.maxR) {
        ripples.splice(r, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${fade})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function tick(now) {
    if (now - lastPulseTime > 2400) {
      lastPulseTime = now;
      triggerLinkPulse();
    }

    drawFrame(false);
    animId = requestAnimationFrame(tick);
  }

  function start() {
    if (animId) return;
    if (motionQuery.matches) {
      drawFrame(true);
      return;
    }
    lastPulseTime = performance.now();
    animId = requestAnimationFrame(tick);
  }

  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    },
    { passive: true },
  );

  window.addEventListener(
    "pointerleave",
    () => {
      pointer.active = false;
    },
    { passive: true },
  );

  window.addEventListener(
    "pointerdown",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      addRipple(e.clientX, e.clientY);
      triggerLinkPulse();
    },
    { passive: true },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  motionQuery.addEventListener("change", () => {
    stop();
    start();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (motionQuery.matches) drawFrame(true);
    }, 150);
  });

  resize();
  start();
})();
