// Particules (confettis, étincelles, braises, cendres) sur <canvas id="fx">
(function () {
  const cv = document.getElementById('fx');
  const noop = () => {};
  if (!cv) {
    window.FX = { confetti: noop, cannons: noop, sparks: noop, embers: noop, ash: noop, clear: noop };
    return;
  }
  const ctx = cv.getContext('2d');
  let W = 0;
  let H = 0;
  let S = 1;
  let parts = [];
  let raf = null;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    S = Math.min(W / 1920, H / 1080) || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function loop() {
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life++;
      p.update(p);
      if (p.dead || p.life > p.max || p.y > H + 80) {
        parts.splice(i, 1);
        continue;
      }
      p.draw(p);
    }
    raf = parts.length ? requestAnimationFrame(loop) : null;
    if (!raf) ctx.clearRect(0, 0, W, H);
  }
  function start() {
    if (!raf) raf = requestAnimationFrame(loop);
  }
  const fade = (p) => Math.max(0, Math.min(1, (p.max - p.life) / 40));

  function confettiPiece(x, y, angle, speed, colors) {
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: rand(11, 19) * S,
      h: rand(6, 10) * S,
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.25, 0.25),
      tilt: rand(0, Math.PI * 2),
      vt: rand(0.08, 0.2),
      phase: rand(0, 6),
      color: pick(colors),
      round: Math.random() < 0.18,
      life: 0,
      max: rand(170, 280),
      update(p) {
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.3 * S;
        p.x += p.vx + Math.sin(p.life * 0.08 + p.phase) * 1.3 * S;
        p.y += p.vy;
        p.rot += p.vr;
        p.tilt += p.vt;
      },
      draw(p) {
        ctx.save();
        ctx.globalAlpha = fade(p);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.tilt));
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.h * 0.6, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      },
    };
  }

  window.FX = {
    confetti({ count = 170, colors = ['#fff'], x = W / 2, y = H * 0.45, power = 1 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + rand(-1, 1) * Math.PI * 0.42;
        parts.push(confettiPiece(x + rand(-60, 60) * S, y + rand(-20, 20) * S, a, rand(9, 25) * S * power, colors));
      }
      start();
    },
    cannons({ count = 90, colors = ['#fff'] } = {}) {
      for (const side of [0, 1]) {
        const x = side ? W * 1.01 : -W * 0.01;
        const base = side ? -Math.PI * 0.68 : -Math.PI * 0.32;
        for (let i = 0; i < count; i++) parts.push(confettiPiece(x, H * 1.02, base + rand(-0.16, 0.16), rand(20, 38) * S, colors));
      }
      start();
    },
    sparks({ count = 90, color = '255,176,32', x = W / 2, y = H / 2 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(7, 22) * S;
        parts.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          size: rand(1.5, 3.5) * S,
          life: 0,
          max: rand(35, 70),
          update(p) {
            p.vx *= 0.93;
            p.vy = p.vy * 0.93 + 0.12 * S;
            p.x += p.vx;
            p.y += p.vy;
          },
          draw(p) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
            ctx.strokeStyle = `rgba(${color},1)`;
            ctx.lineWidth = p.size;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 2.6, p.y - p.vy * 2.6);
            ctx.stroke();
            ctx.restore();
          },
        });
      }
      start();
    },
    embers({ count = 110, colors = ['255,138,42', '255,211,90', '255,77,26'] } = {}) {
      for (let i = 0; i < count; i++) {
        const c = pick(colors);
        parts.push({
          x: rand(0, W),
          y: H + rand(0, 200) * S,
          vx: rand(-0.6, 0.6) * S,
          vy: -rand(2.5, 7) * S,
          size: rand(2, 5.5) * S,
          phase: rand(0, 6),
          life: 0,
          max: rand(150, 260),
          update(p) {
            p.x += p.vx + Math.sin(p.life * 0.05 + p.phase) * 0.8 * S;
            p.y += p.vy;
            p.vy *= 0.997;
          },
          draw(p) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = fade(p) * (0.6 + Math.sin(p.life * 0.3 + p.phase) * 0.4);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
            g.addColorStop(0, `rgba(${c},1)`);
            g.addColorStop(1, `rgba(${c},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          },
        });
      }
      start();
    },
    ash({ count = 60, x = W / 2, y = H * 0.45 } = {}) {
      for (let i = 0; i < count; i++) {
        const shade = Math.round(rand(60, 140));
        parts.push({
          x: x + rand(-420, 420) * S,
          y: y + rand(-60, 60) * S,
          vx: rand(-0.8, 0.8) * S,
          vy: rand(0.2, 1.6) * S,
          size: rand(3, 8) * S,
          rot: rand(0, 6),
          vr: rand(-0.05, 0.05),
          life: 0,
          max: rand(110, 190),
          update(p) {
            p.vy += 0.03 * S;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
          },
          draw(p) {
            ctx.save();
            ctx.globalAlpha = fade(p) * 0.8;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = `rgb(${shade + 40},${shade},${shade})`;
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.lineTo(p.size * 0.8, p.size * 0.6);
            ctx.lineTo(-p.size * 0.7, p.size * 0.5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          },
        });
      }
      start();
    },
    clear() {
      parts = [];
    },
  };
})();
