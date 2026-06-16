/**
 * fluid.js · 轻量 WebGL2 墨水流体仿真（稳定流体 / Stable Fluids）
 * - 鼠标/触摸移动产生牵引力，墨水随之流动、卷曲、融合
 * - 深色主题：发光墨水（mix-blend-mode: screen）
 * - 浅色主题：宣纸洇墨（补色染料 + 反相显示 + multiply 混合，呈减色混合效果）
 * - 不支持 WebGL2 或用户偏好减少动效时优雅退出（返回 null，页面不受影响）
 *
 * 用法：const sim = window.createFluidSim(canvas, pointerHost); sim?.destroy();
 */
(() => {
  "use strict";

  const CONFIG = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 1.6,        // 墨色消散更快 → 画面更轻盈
    VELOCITY_DISSIPATION: 0.9,       // 流速衰减更快 → 流动更舒缓
    PRESSURE_ITERATIONS: 20,
    CURL: 14,                        // 降低卷曲强度，减少剧烈涡旋
    SPLAT_RADIUS: 0.0042,            // 墨滴更大更柔
    SPLAT_FORCE: 2200,               // 鼠标牵引力放轻
    AMBIENT_TICK: 240,               // 环境流注入间隔(ms)：持续而缓慢
    AMBIENT_FORCE: 90,               // 环境流漂移力度（小 → 慢速融合）
    MAX_DPR: 1.5,
    INK_STRENGTH: 0.5,               // 全局墨色浓度系数
  };

  /* 默认紫罗兰墨水色板（线性空间近似），偶尔出现青色 */
  const INK_PALETTE = [
    [0.36, 0.14, 0.92],
    [0.52, 0.28, 0.97],
    [0.63, 0.42, 0.99],
    [0.30, 0.10, 0.80],
    [0.13, 0.72, 0.95],
  ];

  function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  const VERT = `#version 300 es
  precision highp float;
  in vec2 aPosition;
  out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
  uniform vec2 texelSize;
  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }`;

  const FRAG = {
    splat: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; out vec4 outColor;
    uniform sampler2D uTarget; uniform float aspectRatio;
    uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () {
      vec2 p = vUv - point; p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      outColor = vec4(texture(uTarget, vUv).xyz + splat, 1.0);
    }`,

    advection: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; out vec4 outColor;
    uniform sampler2D uVelocity; uniform sampler2D uSource;
    uniform vec2 texelSize; uniform float dt; uniform float dissipation;
    void main () {
      vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
      vec4 result = texture(uSource, coord);
      outColor = result / (1.0 + dissipation * dt);
    }`,

    divergence: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 outColor;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture(uVelocity, vL).x;
      float R = texture(uVelocity, vR).x;
      float T = texture(uVelocity, vT).y;
      float B = texture(uVelocity, vB).y;
      vec2 C = texture(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }
      outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,

    curl: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 outColor;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture(uVelocity, vL).y;
      float R = texture(uVelocity, vR).y;
      float T = texture(uVelocity, vT).x;
      float B = texture(uVelocity, vB).x;
      outColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
    }`,

    vorticity: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 outColor;
    uniform sampler2D uVelocity; uniform sampler2D uCurl;
    uniform float curl; uniform float dt;
    void main () {
      float L = texture(uCurl, vL).x;
      float R = texture(uCurl, vR).x;
      float T = texture(uCurl, vT).x;
      float B = texture(uCurl, vB).x;
      float C = texture(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 velocity = texture(uVelocity, vUv).xy + force * dt;
      velocity = clamp(velocity, vec2(-1000.0), vec2(1000.0));
      outColor = vec4(velocity, 0.0, 1.0);
    }`,

    pressure: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 outColor;
    uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () {
      float L = texture(uPressure, vL).x;
      float R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x;
      float B = texture(uPressure, vB).x;
      float divergence = texture(uDivergence, vUv).x;
      outColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
    }`,

    gradientSubtract: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 outColor;
    uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () {
      float L = texture(uPressure, vL).x;
      float R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x;
      float B = texture(uPressure, vB).x;
      vec2 velocity = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
      outColor = vec4(velocity, 0.0, 1.0);
    }`,

    display: `#version 300 es
    precision highp float; precision highp sampler2D;
    in vec2 vUv; out vec4 outColor;
    uniform sampler2D uTexture; uniform float uInvert;
    void main () {
      vec3 c = texture(uTexture, vUv).rgb;
      c = c / (1.0 + c) * 1.25;           // 柔和压暗高光
      c = clamp(c, 0.0, 1.0);
      outColor = vec4(mix(c, vec3(1.0) - c, uInvert), 1.0);
    }`,
  };

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[fluid] shader 编译失败:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function createProgram(gl, fragSource, texelSize) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[fluid] program 链接失败:", gl.getProgramInfoLog(program));
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms, texelSize };
  }

  window.createFluidSim = function createFluidSim(canvas, pointerHost) {
    if (!canvas) return null;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

    const gl = canvas.getContext("webgl2", { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    if (!gl.getExtension("EXT_color_buffer_float")) return null;

    /* ---------- 几何 ---------- */
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function blit(target) {
      if (target) {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      } else {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /* ---------- FBO ---------- */
    function createFBO(w, h) {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        texture, fbo, width: w, height: h,
        attach(id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }

    function createDoubleFBO(w, h) {
      let fbo1 = createFBO(w, h);
      let fbo2 = createFBO(w, h);
      return {
        width: w, height: h,
        get read() { return fbo1; },
        get write() { return fbo2; },
        swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t; },
      };
    }

    /* ---------- 程序 ---------- */
    const programs = {};
    for (const [name, source] of Object.entries(FRAG)) {
      programs[name] = createProgram(gl, source);
      if (!programs[name]) return null;
    }

    function useProgram(p, texel) {
      gl.useProgram(p.program);
      if (p.uniforms.texelSize && texel) gl.uniform2f(p.uniforms.texelSize, texel[0], texel[1]);
    }

    /* ---------- 状态 ---------- */
    let velocity, dye, divergenceFBO, curlFBO, pressure;
    let simTexel, dyeTexel;
    let rafId = 0;
    let destroyed = false;
    let lastTime = performance.now();
    let nextAmbient = performance.now() + 400;
    let nextAgitate = 0;
    let excitement = 0; // 0 = 平静；1 = 创作中的躁动状态

    // 环境流发射器：各自的游走轨迹与起始色相（紫/青/粉区间起步，随时间全谱旋转）
    const emitters = [
      { speedX: 0.11, speedY: 0.09, phaseX: 0.0, phaseY: 1.7, hue: 0.74 },
      { speedX: 0.07, speedY: 0.13, phaseX: 2.4, phaseY: 0.6, hue: 0.52 },
      { speedX: 0.09, speedY: 0.06, phaseX: 4.2, phaseY: 3.1, hue: 0.91 },
    ];

    function sizes() {
      const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
      const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
      return { w, h };
    }

    function resolution(base, w, h) {
      const aspect = w / h;
      const min = Math.round(base);
      const max = Math.round(base * Math.max(aspect, 1 / aspect));
      return w > h ? { w: max, h: min } : { w: min, h: max };
    }

    function initFrameBuffers() {
      const { w, h } = sizes();
      canvas.width = w;
      canvas.height = h;
      const sim = resolution(CONFIG.SIM_RESOLUTION, w, h);
      const dyeRes = resolution(CONFIG.DYE_RESOLUTION, w, h);
      simTexel = [1 / sim.w, 1 / sim.h];
      dyeTexel = [1 / dyeRes.w, 1 / dyeRes.h];
      velocity = createDoubleFBO(sim.w, sim.h);
      dye = createDoubleFBO(dyeRes.w, dyeRes.h);
      divergenceFBO = createFBO(sim.w, sim.h);
      curlFBO = createFBO(sim.w, sim.h);
      pressure = createDoubleFBO(sim.w, sim.h);
    }

    initFrameBuffers();

    const isLight = () => document.documentElement.dataset.theme === "light";

    /* ---------- 墨色（可切换） ---------- */
    let inkColors = INK_PALETTE;
    let rainbowMode = false;

    function pickInk(intensity, light) {
      const strength = intensity * CONFIG.INK_STRENGTH;
      const base = rainbowMode
        ? hsvToRgb(Math.random(), 0.72 + Math.random() * 0.28, 1)
        : inkColors[(Math.random() * inkColors.length) | 0];
      // 深色：墨水即光（加色混合）；浅色：存补色染料，显示端 1-dye 还原原色（减色混合，似墨入宣纸）
      return light ? base.map((v) => (1 - v) * strength) : base.map((v) => v * strength);
    }

    /* ---------- 墨滴 ---------- */
    function splat(x, y, dx, dy, color) {
      useProgram(programs.splat);
      gl.uniform1i(programs.splat.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(programs.splat.uniforms.aspectRatio, canvas.width / canvas.height);
      gl.uniform2f(programs.splat.uniforms.point, x, y);
      gl.uniform3f(programs.splat.uniforms.color, dx, dy, 0);
      gl.uniform1f(programs.splat.uniforms.radius, CONFIG.SPLAT_RADIUS);
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(programs.splat.uniforms.uTarget, dye.read.attach(0));
      gl.uniform3f(programs.splat.uniforms.color, color[0], color[1], color[2]);
      blit(dye.write);
      dye.swap();
    }

    function inkSplat(x, y, dx, dy, intensity) {
      splat(x, y, dx, dy, pickInk(intensity, isLight()));
    }

    function burst(count) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        inkSplat(
          0.2 + Math.random() * 0.6,
          0.25 + Math.random() * 0.5,
          Math.cos(angle) * 600 * Math.random(),
          Math.sin(angle) * 600 * Math.random(),
          0.45 + Math.random() * 0.5,
        );
      }
    }

    /* ---------- 指针 ---------- */
    const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, inside: false };
    const host = pointerHost || canvas;

    function pointerPos(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
      };
    }

    function onMove(event) {
      const pos = pointerPos(event);
      if (!pos) return;
      if (pointer.inside) {
        pointer.dx = (pos.x - pointer.x) * CONFIG.SPLAT_FORCE;
        pointer.dy = (pos.y - pointer.y) * CONFIG.SPLAT_FORCE;
        if (Math.abs(pointer.dx) > 1 || Math.abs(pointer.dy) > 1) pointer.moved = true;
      }
      pointer.x = pos.x;
      pointer.y = pos.y;
      pointer.inside = true;
    }

    function onLeave() {
      pointer.inside = false;
    }

    function onDown(event) {
      const pos = pointerPos(event);
      if (!pos) return;
      const angle = Math.random() * Math.PI * 2;
      inkSplat(pos.x, pos.y, Math.cos(angle) * 800, Math.sin(angle) * 800, 0.9);
    }

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave, { passive: true });
    host.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("resize", initFrameBuffers);

    /* ---------- 仿真步进 ---------- */
    function step(dt) {
      gl.disable(gl.BLEND);

      useProgram(programs.curl, simTexel);
      gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
      blit(curlFBO);

      useProgram(programs.vorticity, simTexel);
      gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(programs.vorticity.uniforms.uCurl, curlFBO.attach(1));
      gl.uniform1f(programs.vorticity.uniforms.curl, CONFIG.CURL);
      gl.uniform1f(programs.vorticity.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      useProgram(programs.divergence, simTexel);
      gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergenceFBO);

      useProgram(programs.pressure, simTexel);
      gl.uniform1i(programs.pressure.uniforms.uDivergence, divergenceFBO.attach(1));
      for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i += 1) {
        gl.uniform1i(programs.pressure.uniforms.uPressure, pressure.read.attach(0));
        blit(pressure.write);
        pressure.swap();
      }

      useProgram(programs.gradientSubtract, simTexel);
      gl.uniform1i(programs.gradientSubtract.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(programs.gradientSubtract.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write);
      velocity.swap();

      useProgram(programs.advection, simTexel);
      gl.uniform2f(programs.advection.uniforms.texelSize, simTexel[0], simTexel[1]);
      gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(programs.advection.uniforms.uSource, velocity.read.attach(0));
      gl.uniform1f(programs.advection.uniforms.dt, dt);
      gl.uniform1f(programs.advection.uniforms.dissipation, CONFIG.VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
      gl.uniform1f(programs.advection.uniforms.dissipation, CONFIG.DENSITY_DISSIPATION);
      blit(dye.write);
      dye.swap();
    }

    function render() {
      useProgram(programs.display);
      gl.uniform1i(programs.display.uniforms.uTexture, dye.read.attach(0));
      gl.uniform1f(programs.display.uniforms.uInvert, isLight() ? 1 : 0);
      blit(null);
    }

    function frame(now) {
      if (destroyed) return;
      rafId = requestAnimationFrame(frame);
      if (!canvas.isConnected) { api.destroy(); return; }
      if (!canvas.offsetWidth || document.hidden) return; // 不可见时空转省电

      const dt = Math.min((now - lastTime) / 1000, 0.0166);
      lastTime = now;

      if ((canvas.clientWidth && Math.abs(canvas.width - Math.floor(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR))) > 2)) {
        initFrameBuffers();
      }

      if (pointer.moved) {
        pointer.moved = false;
        inkSplat(pointer.x, pointer.y, pointer.dx, pointer.dy, 0.32);
      }

      // 创作中：墨水躁动 —— 中心区域高频强力注墨，体现「正在创作」
      if (excitement > 0 && now > nextAgitate) {
        nextAgitate = now + 85;
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.06 + Math.random() * 0.2;
        inkSplat(
          0.5 + Math.cos(angle) * radius,
          0.5 + Math.sin(angle) * radius * 0.8,
          Math.cos(angle + 2.0) * 1500 * excitement,
          Math.sin(angle + 2.0) * 1500 * excitement,
          0.34 * excitement,
        );
      }

      // 常态环境流：3 个缓慢游走的发射器持续注入多色淡墨，鼠标不动时画面也在流动
      if (now > nextAmbient) {
        nextAmbient = now + CONFIG.AMBIENT_TICK;
        const t = now / 1000;
        for (const emitter of emitters) {
          const x = 0.5 + 0.4 * Math.sin(t * emitter.speedX + emitter.phaseX);
          const y = 0.5 + 0.36 * Math.cos(t * emitter.speedY + emitter.phaseY);
          // 漂移方向 = 位置函数的导数 → 墨随发射器游走方向缓慢流动
          const dx = 0.4 * emitter.speedX * Math.cos(t * emitter.speedX + emitter.phaseX) * CONFIG.AMBIENT_FORCE;
          const dy = -0.36 * emitter.speedY * Math.sin(t * emitter.speedY + emitter.phaseY) * CONFIG.AMBIENT_FORCE;
          // 多种颜色融合：每个发射器各自的色相随时间缓慢旋转
          emitter.hue = (emitter.hue + 0.0023) % 1;
          const strength = 0.12 * CONFIG.INK_STRENGTH;
          const rgb = hsvToRgb(emitter.hue, 0.62, 1);
          splat(x, y, dx, dy, isLight() ? rgb.map((v) => (1 - v) * strength) : rgb.map((v) => v * strength));
        }
      }

      step(dt);
      render();
    }

    const api = {
      /** 创作躁动：0 平静，1 全力躁动 */
      setExcitement(level) {
        excitement = Math.max(0, Math.min(1, Number(level) || 0));
      },
      /** 墨水从中心向四周散开（作品揭幕时刻） */
      disperse() {
        for (let i = 0; i < 14; i += 1) {
          const angle = (i / 14) * Math.PI * 2;
          inkSplat(
            0.5 + Math.cos(angle) * 0.05,
            0.5 + Math.sin(angle) * 0.05,
            Math.cos(angle) * 2400,
            Math.sin(angle) * 2400,
            0.2,
          );
        }
      },
      /** 切换墨水主色：传入 RGB(0~1) 三元组数组，或 "rainbow" 开启随机彩 */
      setInk(value) {
        if (value === "rainbow") {
          rainbowMode = true;
        } else if (Array.isArray(value) && value.length) {
          inkColors = value;
          rainbowMode = false;
        }
        burst(3); // 切色后立刻迸几滴新墨反馈
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(rafId);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerleave", onLeave);
        host.removeEventListener("pointerdown", onDown);
        window.removeEventListener("resize", initFrameBuffers);
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      },
    };

    burst(5);
    rafId = requestAnimationFrame(frame);
    return api;
  };
})();
