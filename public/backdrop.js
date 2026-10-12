(function backdrop() {
  const canvas = document.getElementById('bg-fx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dots = [];
  const count = 72;
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.28;
  const velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  const pointer = { x: -9999, y: -9999 };
  let width = 0;
  let height = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!dots.length) {
      for (let i = 0; i < count; i += 1) {
        dots.push({ x: Math.random() * width, y: Math.random() * height });
      }
    }
  }

  function silhouette(time) {
    const x = width * 0.5 + Math.sin(time * 0.00035) * width * 0.22;
    const y = height * 0.48 + Math.cos(time * 0.00027) * height * 0.12;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + Math.sin(time * 0.0005) * 0.06, 1);
    ctx.filter = 'blur(22px)';
    ctx.fillStyle = 'rgba(82, 51, 68, 0.85)';
    ctx.beginPath();
    ctx.arc(0, -70, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-78, 120);
    ctx.quadraticCurveTo(-90, 10, -36, -16);
    ctx.quadraticCurveTo(0, -36, 36, -16);
    ctx.quadraticCurveTo(90, 10, 78, 120);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function frame(time) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#070408';
    ctx.fillRect(0, 0, width, height);
    silhouette(time);
    for (const dot of dots) {
      dot.x += velocity.x;
      dot.y += velocity.y;
      if (dot.x < 0) dot.x += width;
      if (dot.y < 0) dot.y += height;
      if (dot.x > width) dot.x -= width;
      if (dot.y > height) dot.y -= height;
    }
    const near = dots.filter((dot) => {
      const dx = dot.x - pointer.x;
      const dy = dot.y - pointer.y;
      return dx * dx + dy * dy < 150 * 150;
    });
    ctx.strokeStyle = 'rgba(166, 117, 66, 0.55)';
    ctx.lineWidth = 1;
    for (let i = 0; i < near.length; i += 1) {
      for (let j = i + 1; j < near.length; j += 1) {
        ctx.beginPath();
        ctx.moveTo(near[i].x, near[i].y);
        ctx.lineTo(near[j].x, near[j].y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(229, 214, 196, 0.85)';
    for (const dot of dots) {
      ctx.fillRect(dot.x, dot.y, 2, 2);
    }
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
