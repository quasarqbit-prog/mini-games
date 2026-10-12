(function backdrop() {
  const canvas = document.getElementById('bg-net');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const particles = [];
  const pointer = { x: -9999, y: -9999 };
  const maxDistance = 120;
  const mouseRadius = 150;
  let width = 0;
  let height = 0;

  function targetCount() {
    const area = window.innerWidth * window.innerHeight;
    return Math.max(60, Math.min(190, Math.round(area / 12000)));
  }

  function wrap(value, size) {
    const span = size + maxDistance * 2;
    const min = -maxDistance;
    const max = size + maxDistance;
    if (span <= 0 || (value >= min && value <= max)) return value;
    return min + (((value - min) % span) + span) % span;
  }

  function spawn() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.12 + Math.random() * 0.28;
    return {
      x: -maxDistance + Math.random() * (width + maxDistance * 2),
      y: -maxDistance + Math.random() * (height + maxDistance * 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 1.5 + Math.random() * 1.5,
    };
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = targetCount();
    while (particles.length < count) particles.push(spawn());
    if (particles.length > count) particles.length = count;
  }

  function ink() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    return value || '#F6EFE4';
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    for (const dot of particles) {
      dot.x = wrap(dot.x + dot.vx, width);
      dot.y = wrap(dot.y + dot.vy, height);
    }

    const color = ink();
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= maxDistance) continue;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - distance / maxDistance;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const mx = a.x - pointer.x;
      const my = a.y - pointer.y;
      const mouseDistance = Math.hypot(mx, my);
      if (mouseDistance >= mouseRadius) continue;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - mouseDistance / mouseRadius;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(pointer.x, pointer.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = color;
    for (const dot of particles) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  window.addEventListener('pointerleave', () => {
    pointer.x = -9999;
    pointer.y = -9999;
  });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
