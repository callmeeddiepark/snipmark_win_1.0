// Tauri Window Controls
if (window.__TAURI__) {
  const { getCurrentWindow } = window.__TAURI__.window;
  const appWindow = getCurrentWindow();

  document.getElementById('titlebar-minimize').addEventListener('click', () => appWindow.minimize());
  document.getElementById('titlebar-maximize').addEventListener('click', () => appWindow.toggleMaximize());
  document.getElementById('titlebar-close').addEventListener('click', () => appWindow.close());
}

const state = {
  tabs: [],
  activeTabId: null,
  closedStack: [],
  gesture: null,
  mode: "manual",
  activeMarkerId: null,
  draggingId: null,
  currentTool: "select",
  strokeColor: "#8E0015",
  strokeWidth: 4,
  markerColor: "#8E0015", // Red-ish Burgundy
  signatures: [],
  theme: "dark",
  isSpacePressed: false,
  copiedMarker: null,
  isCapturing: false,
};





const STORAGE_KEY = "snapmark-tabs-v2";
const clamp = v => Math.max(0, Math.min(1, v));
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nowId = () => Date.now() + Math.random();

// ── DOM Elements ──
const canvasWrapper = document.getElementById("canvasWrapper");
const dropZone = document.getElementById("dropZone");
const imageStage = document.getElementById("imageStage");
const imageContainer = document.getElementById("imageContainer");
const mainImage = document.getElementById("mainImage");
const markersLayer = document.getElementById("markersLayer");
const dragSelection = document.getElementById("dragSelection");
const markerList = document.getElementById("markerList");
const fileInput = document.getElementById("fileInput");
const filenameDisplay = document.getElementById("filenameDisplay");
const zoomLevel = document.getElementById("zoomLevel");
const tabsEl = document.getElementById("tabs");
const newTabBtn = document.getElementById("newTabBtn");
const reopenTabBtn = document.getElementById("reopenTabBtn");
const instructionModal = document.getElementById("instructionModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const helpBtn = document.getElementById("helpBtn");
const annotationToolbar = document.getElementById("annotationToolbar");
const activeColorBtn = document.getElementById("activeColorBtn");
const strokeWidthSelect = document.getElementById("strokeWidthSelect");
const rotateBtn = document.getElementById("rotateBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const sideMarkerColorBtn = document.getElementById("sideMarkerColorBtn");
const magnifier = document.getElementById("magnifier");
const magnifierCanvas = document.getElementById("magnifierCanvas");
let magCtx = null;
if (magnifierCanvas) magCtx = magnifierCanvas.getContext("2d", { alpha: false });


// ── Tab Management ──
function createTab(name = "새 탭") {
  return {
    id: nowId(),
    title: name,
    fileName: "",
    imageDataUrl: "",
    signatureDataUrl: "", // Added for signature pad logic
    imageNaturalW: 0,
    imageNaturalH: 0,
    zoom: 1,
    markers: [],
    history: [],
    activeMarkerId: null,
    closed: false,
    autoFitPending: false,
    rotation: 0
  };
}


const current = () => state.tabs.find(t => t.id === state.activeTabId && !t.closed) || null;

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    closedStack: state.closedStack,
    mode: state.mode,
    markerColor: state.markerColor,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth
  }));
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.tabs) || !data.tabs.length) return false;
    state.tabs = data.tabs;
    state.activeTabId = data.activeTabId;
    state.closedStack = Array.isArray(data.closedStack) ? data.closedStack : [];
    state.mode = "manual";
    const isLight = document.body.classList.contains("light-mode");
    const color = isLight ? "#000000" : "#ffffff";
    state.markerColor = color;
    state.strokeColor = color;
    if (data.strokeWidth) state.strokeWidth = data.strokeWidth;
    if (!current()) {
      state.activeTabId = state.tabs.find(t => !t.closed)?.id ?? state.tabs[0].id;
    }
    return true;
  } catch { return false; }
}

function ensureOneOpenTab() {
  if (state.tabs.filter(x => !x.closed).length === 0) {
    const t = createTab("탭 1");
    state.tabs.push(t);
    state.activeTabId = t.id;
  }
}

// ── Theme Management ──
const THEME_KEY = "snapmark-theme";
function applyTheme(theme) {
  state.theme = theme;
  const isLight = theme === "light";
  if (isLight) {
    document.documentElement.classList.add("light-mode");
    document.body.classList.add("light-mode");
    themeToggleBtn.textContent = "☀️";
    sideMarkerColorBtn.style.color = "#000000";
  }
  else {
    document.documentElement.classList.remove("light-mode");
    document.body.classList.remove("light-mode");
    themeToggleBtn.textContent = "🌙";
    sideMarkerColorBtn.style.color = "#ffffff";
  }
  localStorage.setItem(THEME_KEY, theme);
  renderMarkers();
  updateMarkerList();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const t of state.tabs.filter(x => !x.closed)) {
    const el = document.createElement("div");
    el.className = `tab ${t.id === state.activeTabId ? "active" : ""}`;
    el.innerHTML = `<span>${esc(t.title)}</span><button class="tab-close">✕</button>`;
    el.onclick = () => switchTab(t.id);
    el.querySelector(".tab-close").onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
    tabsEl.appendChild(el);
  }
}

function switchTab(id) {
  state.activeTabId = id;
  renderTabs();
  renderFromTab();
  persist();
}

function closeTab(id) {
  const t = state.tabs.find(x => x.id === id);
  if (!t) return;
  t.closed = true;
  state.closedStack.push(id);
  if (state.activeTabId === id) {
    state.activeTabId = state.tabs.find(x => !x.closed)?.id || null;
  }
  ensureOneOpenTab();
  renderTabs();
  renderFromTab();
  persist();
}

function reopenLastClosedTab() {
  const id = state.closedStack.pop();
  if (!id) return;
  const t = state.tabs.find(x => x.id === id);
  if (t) {
    t.closed = false;
    switchTab(id);
  }
}

function renderFromTab() {
  const t = current();
  if (!t || !t.imageDataUrl) {
    imageStage.style.display = "none";
    dropZone.style.display = "grid";
    filenameDisplay.textContent = "이미지를 불러오세요";
    zoomLevel.textContent = "100%";
    markersLayer.innerHTML = "";
    markerList.innerHTML = `<div class="empty">좌측 하단 '파일 열기' 또는 이미지를 드래그하세요</div>`;
    return;
  }

  mainImage.onload = () => {
    t.imageNaturalW = mainImage.naturalWidth;
    t.imageNaturalH = mainImage.naturalHeight;
    t.rotation = 0; // Explicitly ensure zero rotation

    if (t.autoFitPending) {
      const wr = document.getElementById("canvasWrapper").getBoundingClientRect();
      t.zoom = Math.min((wr.width - 80) / t.imageNaturalW, (wr.height - 80) / t.imageNaturalH, 1);
      t.autoFitPending = false;
    }
    applyZoom();
    renderMarkers();
    updateMarkerList();
  };
  
  if (mainImage.src !== t.imageDataUrl) {
    mainImage.src = "";
    mainImage.src = t.imageDataUrl;
  }
  
  imageStage.style.display = "flex";
  dropZone.style.display = "none";
  annotationToolbar.style.display = "flex";
  filenameDisplay.textContent = t.fileName || t.title;
}


// ── Interaction Logic ──
function getPos(clientX, clientY) {
  const t = current();
  const rect = imageContainer.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const w = (t?.imageNaturalW || 1) * (t?.zoom || 1);
  const h = (t?.imageNaturalH || 1) * (t?.zoom || 1);
  return { px, py, rx: px / w, ry: py / h };
}

function updateMagnifier(clientX, clientY) {
  const t = current();
  if (!t || !mainImage.complete || !magnifier || !magnifierCanvas) return;
  if (!magCtx) magCtx = magnifierCanvas.getContext("2d", { alpha: false });
  if (!magCtx) return;

  const magSize = 140; 
  if (magnifierCanvas.width !== magSize) {
    magnifierCanvas.width = magSize;
    magnifierCanvas.height = magSize;
  }

  const { rx, ry } = getPos(clientX, clientY);
  
  // Magnification factor (2x)
  const zoom = 2;
  const sw = (magSize / zoom) / t.zoom;
  const sh = (magSize / zoom) / t.zoom;
  const sx = rx * t.imageNaturalW - sw / 2;
  const sy = ry * t.imageNaturalH - sh / 2;

  magCtx.fillStyle = state.theme === "dark" ? "#000" : "#fff";
  magCtx.fillRect(0, 0, magSize, magSize);
  
  try {
    magCtx.drawImage(
      mainImage,
      sx, sy, sw, sh,
      0, 0, magSize, magSize
    );
  } catch (e) {
    // Out of bounds or image not ready
  }

  // Positioning: 100px above the cursor
  magnifier.style.display = "block";
  magnifier.style.left = `${clientX - magSize / 2}px`;
  magnifier.style.top = `${clientY - magSize - 40}px`;
}

function inside(px, py) {
  const t = current();
  const w = (t?.imageNaturalW || 0) * (t?.zoom || 1);
  const h = (t?.imageNaturalH || 0) * (t?.zoom || 1);
  return px >= 0 && py >= 0 && px <= w && py <= h;
}

function saveHistory() {
  const t = current(); if (!t) return;
  t.history.push(JSON.parse(JSON.stringify(t.markers)));
  if (t.history.length > 30) t.history.shift();
}

imageStage.addEventListener("dragstart", e => e.preventDefault());
imageStage.addEventListener("pointerdown", e => {
  e.preventDefault();
  const t = current();
  if (!t?.imageDataUrl) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;

  if (state.isSpacePressed) {
    state.gesture = { 
      type: "pan", 
      pointerId: e.pointerId, 
      startX: e.clientX, 
      startY: e.clientY,
      scrollLeft: canvasWrapper.scrollLeft,
      scrollTop: canvasWrapper.scrollTop
    };
    imageStage.setPointerCapture(e.pointerId);
    return;
  }

  const targetBadge = e.target.closest(".marker-badge, .region-badge");
  const targetResize = e.target.closest(".resize-handle");
  const targetRegion = e.target.closest(".region-box");

  if (targetResize) {
    const mid = targetResize.getAttribute("data-id");
    const marker = t.markers.find(m => String(m.id) === String(mid));
    if (marker) {
      saveHistory();
      state.activeMarkerId = marker.id;
      state.gesture = { type: "resize", pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, initialX2: marker.x2, initialY2: marker.y2 };
      targetResize.setPointerCapture(e.pointerId);
      updateMagnifier(e.clientX, e.clientY);
      return;
    }
  }

  if (targetBadge || targetRegion) {
    const target = targetBadge || targetRegion;
    const mid = target.getAttribute("data-id") || target.parentElement.getAttribute("data-id");
    if (mid) {
      const marker = t.markers.find(m => String(m.id) === String(mid));
      if (marker) {
        saveHistory();
        state.activeMarkerId = marker.id;
        state.draggingId = marker.id;
        state.gesture = { 
          type: "move", 
          pointerId: e.pointerId, 
          startX: e.clientX, 
          startY: e.clientY, 
          initialX: marker.x, 
          initialY: marker.y,
          initialX1: marker.x1, 
          initialY1: marker.y1,
          initialX2: marker.x2,
          initialY2: marker.y2
        };
        (targetBadge || targetRegion).setPointerCapture(e.pointerId);
        updateMarkerList();
        renderMarkers();
        updateMagnifier(e.clientX, e.clientY);
        return;
      }
    }
  }

  const { px, py, rx, ry } = getPos(e.clientX, e.clientY);
  if (!inside(px, py)) return;

  if (state.currentTool === "select") {
    state.gesture = { type: "create", pointerId: e.pointerId, startPX: px, startPY: py, startRX: rx, startRY: ry, lastRX: rx, lastRY: ry, moved: false };
  } else if (["sketch", "draw", "highlight"].includes(state.currentTool)) {
    saveHistory();
    const nm = { id: nowId(), type: "path", tool: state.currentTool, points: [{ x: rx, y: ry }], color: state.strokeColor, width: state.strokeWidth };
    t.markers.push(nm);
    state.gesture = { type: "drawPath", pointerId: e.pointerId, markerId: nm.id };
  } else if (["rect", "circle", "arrow"].includes(state.currentTool)) {
    saveHistory();
    const nm = { id: nowId(), type: "shape", shapeType: state.currentTool, x1: rx, y1: ry, x2: rx, y2: ry, color: state.strokeColor, width: state.strokeWidth };
    t.markers.push(nm);
    state.gesture = { type: "drawShape", pointerId: e.pointerId, markerId: nm.id, startRX: rx, startRY: ry };
  }
  if (state.gesture && ["create", "drawPath", "drawShape", "move", "resize"].includes(state.gesture.type)) {
    updateMagnifier(e.clientX, e.clientY);
  }
});

imageStage.addEventListener("pointermove", e => {
  e.preventDefault();
  const t = current(); if (!t || !state.gesture || state.gesture.pointerId !== e.pointerId) return;
  const g = state.gesture;

  if (["create", "drawPath", "drawShape", "move", "resize"].includes(g.type)) {
    updateMagnifier(e.clientX, e.clientY);
  }

  if (g.type === "move" && state.draggingId) {
    const marker = t.markers.find(m => m.id === state.draggingId);
    if (!marker) return;
    const dx = (e.clientX - g.startX) / (t.imageNaturalW * t.zoom);
    const dy = (e.clientY - g.startY) / (t.imageNaturalH * t.zoom);
    
    if (marker.type === "point") {
      marker.x = clamp(g.initialX + dx);
      marker.y = clamp(g.initialY + dy);
    } else if (marker.type === "region" || marker.type === "shape") {
      const w = g.initialX2 - g.initialX1;
      const h = g.initialY2 - g.initialY1;
      marker.x1 = clamp(g.initialX1 + dx);
      marker.y1 = clamp(g.initialY1 + dy);
      marker.x2 = marker.x1 + w;
      marker.y2 = marker.y1 + h;
    }
    renderMarkers(); persist();
    return;
  }

  if (g.type === "resize") {
    const marker = t.markers.find(m => m.id === state.activeMarkerId);
    if (!marker) return;
    const dx = (e.clientX - g.startX) / (t.imageNaturalW * t.zoom);
    const dy = (e.clientY - g.startY) / (t.imageNaturalH * t.zoom);
    marker.x2 = clamp(g.initialX2 + dx);
    marker.y2 = clamp(g.initialY2 + dy);
    renderMarkers(); persist();
    return;
  }

  if (g.type === "drawPath") {
    const marker = t.markers.find(m => m.id === g.markerId);
    if (!marker) return;
    const { rx, ry } = getPos(e.clientX, e.clientY);
    marker.points.push({ x: rx, y: ry });
    renderMarkers();
    return;
  }

  if (g.type === "drawShape") {
    const marker = t.markers.find(m => m.id === g.markerId);
    if (!marker) return;
    let { rx, ry } = getPos(e.clientX, e.clientY);
    if (e.shiftKey) {
      const W = t.imageNaturalW * t.zoom;
      const H = t.imageNaturalH * t.zoom;
      const ox = marker.x1, oy = marker.y1;
      // Work in pixels for correct visual proportion
      const dxPx = (rx - ox) * W;
      const dyPx = (ry - oy) * H;
      if (marker.shapeType === "rect" || marker.shapeType === "circle") {
        const sidePx = Math.min(Math.abs(dxPx), Math.abs(dyPx));
        rx = ox + Math.sign(dxPx) * sidePx / W;
        ry = oy + Math.sign(dyPx) * sidePx / H;
      } else if (marker.shapeType === "arrow") {
        const angle = Math.atan2(dyPx, dxPx);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
        rx = ox + Math.cos(snapped) * len / W;
        ry = oy + Math.sin(snapped) * len / H;
      }
    }
    marker.x2 = rx; marker.y2 = ry;
    renderMarkers();
    return;
  }

  if (g.type === "create") {
    const { px, py, rx, ry } = getPos(e.clientX, e.clientY);
    g.lastRX = rx; g.lastRY = ry;
    if (!g.moved && (Math.abs(px - g.startPX) > 4 || Math.abs(py - g.startPY) > 4)) g.moved = true;
    if (!g.moved) return;
    dragSelection.style.display = "block";
    dragSelection.style.left = `${Math.min(px, g.startPX)}px`;
    dragSelection.style.top = `${Math.min(py, g.startPY)}px`;
    dragSelection.style.width = `${Math.abs(px - g.startPX)}px`;
    dragSelection.style.height = `${Math.abs(py - g.startPY)}px`;
  }

  if (g.type === "pan") {
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    canvasWrapper.scrollLeft = g.scrollLeft - dx;
    canvasWrapper.scrollTop = g.scrollTop - dy;
    document.body.classList.add("grabbing");
  }
});

imageStage.addEventListener("pointerup", e => {
  const t = current();
  if (!t || !state.gesture || state.gesture.pointerId !== e.pointerId) return;
  const g = state.gesture;
  if (g.type === "pan") {
    imageStage.releasePointerCapture(e.pointerId);
    document.body.classList.remove("grabbing");
  }
  state.gesture = null;
  state.draggingId = null;
  dragSelection.style.display = "none";
  if (magnifier) magnifier.style.display = "none";
  
  if (g.type === "create") {
    if (!g.moved) {
      saveHistory();
      const nm = { id: nowId(), type: "point", x: clamp(g.startRX), y: clamp(g.startRY), note: "", number: t.markers.length+1, color: state.markerColor };
      t.markers.push(nm);
      state.activeMarkerId = nm.id; state.shouldFocusMemo = true;
    } else {
      const x1 = clamp(Math.min(g.startRX, g.lastRX)), y1 = clamp(Math.min(g.startRY, g.lastRY));
      const x2 = clamp(Math.max(g.startRX, g.lastRX)), y2 = clamp(Math.max(g.startRY, g.lastRY));
      if ((x2-x1) < 0.01 || (y2-y1) < 0.01) return;
      saveHistory();
      const nm = { id: nowId(), type: "region", x1, y1, x2, y2, note: "", number: t.markers.length+1, color: state.markerColor };
      t.markers.push(nm);
      state.activeMarkerId = nm.id; state.shouldFocusMemo = true;
    }
  }
  renderMarkers(); updateMarkerList(); persist();
});


// ── Rendering ──
function renderMarkers() {
  const t = current(); if (!t || !t.imageDataUrl) return;
  markersLayer.innerHTML = "";
  t.markers.forEach(m => {
    if (m.type === "point") renderPoint(m, t);
    else if (m.type === "region") renderRegion(m, t);
    else if (m.type === "path") renderPath(m, t);
    else if (m.type === "shape") renderShape(m, t);
  });
}

function renderPath(m, t) {
  const W = t.imageNaturalW * t.zoom, H = t.imageNaturalH * t.zoom;
  if (!m.points || m.points.length < 2) return;

  const xs = m.points.map(p => p.x * W), ys = m.points.map(p => p.y * H);
  const bx = Math.min(...xs), by = Math.min(...ys);

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;`;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;`;
  svg.style.pointerEvents = "none";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  let d = `M ${m.points[0].x * W} ${m.points[0].y * H}`;
  for (let i = 1; i < m.points.length; i++) d += ` L ${m.points[i].x * W} ${m.points[i].y * H}`;
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", m.color || state.strokeColor);
  path.setAttribute("stroke-width", m.width);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  if (m.tool === "sketch") {
    path.style.filter = "url(#pencilFilter)";
    path.setAttribute("opacity", "0.9");
  } else if (m.tool === "highlight") {
    path.style.filter = "url(#crayonFilter)";
    path.setAttribute("opacity", "0.6");
  } else if (m.tool === "draw") {
    path.setAttribute("opacity", "1.0");
  }
  svg.appendChild(path);

  const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  hitPath.setAttribute("d", d);
  hitPath.setAttribute("fill", "none");
  hitPath.setAttribute("stroke", "transparent");
  hitPath.setAttribute("stroke-width", Math.max(m.width, 14));
  hitPath.style.pointerEvents = "stroke";
  hitPath.style.cursor = "pointer";
  svg.style.pointerEvents = "all";
  svg.appendChild(hitPath);

  const delBtn = document.createElement("button");
  delBtn.className = "path-delete-btn";
  delBtn.textContent = "✕";
  delBtn.style.left = `${bx}px`;
  delBtn.style.top = `${by - 18}px`;
  delBtn.style.pointerEvents = "auto";
  const capturedId = m.id;
  delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  delBtn.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const t2 = current(); if (!t2) return;
    saveHistory();
    t2.markers = t2.markers.filter(x => x.id !== capturedId);
    t2.markers.forEach((x, i) => { if (x.number !== undefined) x.number = i + 1; });
    renderMarkers(); updateMarkerList(); persist();
  });

  wrapper.appendChild(svg);
  wrapper.appendChild(delBtn);

  svg.addEventListener("pointerenter", () => delBtn.classList.add("visible"));
  svg.addEventListener("pointerleave", () => { if (!delBtn.matches(":hover")) delBtn.classList.remove("visible"); });
  delBtn.addEventListener("mouseleave", () => delBtn.classList.remove("visible"));

  markersLayer.appendChild(wrapper);
}


function renderShape(m, t) {
  const W = t.imageNaturalW * t.zoom, H = t.imageNaturalH * t.zoom;
  const x1 = m.x1 * W, y1 = m.y1 * H, x2 = m.x2 * W, y2 = m.y2 * H;
  const bx = Math.min(x1, x2), by = Math.min(y1, y2);

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;`;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;`;
  svg.style.pointerEvents = "all";
  svg.style.cursor = "pointer";

  if (m.shapeType === "rect") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", bx); rect.setAttribute("y", by);
    rect.setAttribute("width", Math.abs(x2 - x1)); rect.setAttribute("height", Math.abs(y2 - y1));
    rect.setAttribute("fill", "none"); rect.setAttribute("stroke", m.color || state.strokeColor); rect.setAttribute("stroke-width", m.width);
    const hit = rect.cloneNode(); hit.setAttribute("fill", "transparent"); hit.setAttribute("stroke", "transparent"); hit.setAttribute("stroke-width", "10");
    svg.append(rect, hit);
  } else if (m.shapeType === "circle") {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", (x1 + x2) / 2); ellipse.setAttribute("cy", (y1 + y2) / 2);
    ellipse.setAttribute("rx", Math.abs(x2 - x1) / 2); ellipse.setAttribute("ry", Math.abs(y2 - y1) / 2);
    ellipse.setAttribute("fill", "none"); ellipse.setAttribute("stroke", m.color || state.strokeColor); ellipse.setAttribute("stroke-width", m.width);
    const hit = ellipse.cloneNode(); hit.setAttribute("fill", "transparent"); hit.setAttribute("stroke", "transparent"); hit.setAttribute("stroke-width", "10");
    svg.append(ellipse, hit);
  } else if (m.shapeType === "arrow") {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", m.color || state.strokeColor); line.setAttribute("stroke-width", m.width);
    const angle = Math.atan2(y2 - y1, x2 - x1), headLen = 15;
    const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
    head.setAttribute("d", `M ${x2 - headLen * Math.cos(angle - Math.PI/6)} ${y2 - headLen * Math.sin(angle - Math.PI/6)} L ${x2} ${y2} L ${x2 - headLen * Math.cos(angle + Math.PI/6)} ${y2 - headLen * Math.sin(angle + Math.PI/6)}`);
    head.setAttribute("fill", "none"); head.setAttribute("stroke", m.color || state.strokeColor); head.setAttribute("stroke-width", m.width);
    svg.append(line, head);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "path-delete-btn";
  delBtn.textContent = "✕";
  delBtn.style.left = `${bx}px`;
  delBtn.style.top = `${by - 18}px`;
  delBtn.style.pointerEvents = "auto";
  const capturedId = m.id;
  delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  delBtn.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const t2 = current(); if (!t2) return;
    saveHistory();
    t2.markers = t2.markers.filter(x => x.id !== capturedId);
    t2.markers.forEach((x, i) => { if (x.number !== undefined) x.number = i + 1; });
    renderMarkers(); updateMarkerList(); persist();
  });

  wrapper.appendChild(svg);
  wrapper.appendChild(delBtn);

  svg.addEventListener("pointerenter", () => delBtn.classList.add("visible"));
  svg.addEventListener("pointerleave", () => { if (!delBtn.matches(":hover")) delBtn.classList.remove("visible"); });
  delBtn.addEventListener("mouseleave", () => delBtn.classList.remove("visible"));

  markersLayer.appendChild(wrapper);
}


function renderPoint(m, t) {
  const W = t.imageNaturalW * t.zoom, H = t.imageNaturalH * t.zoom;
  const isActive = state.activeMarkerId === m.id;
  const el = document.createElement("div");
  el.className = `marker-badge ${isActive ? "active" : ""}`;
  
  const isLight = document.documentElement.classList.contains("light-mode") || document.body.classList.contains("light-mode");
  const bg = m.color || "#8E0015"; // Default to Burgundy
  const fg = "#ffffff"; // White text for best contrast on Burgundy
  
  el.style.cssText = `left:${m.x * W}px; top:${m.y * H}px; background-color:${bg} !important; color:${fg} !important; border: 1px solid ${fg};`;
  if (isActive) el.style.boxShadow = `0 0 0 4px ${bg}99`;
  el.setAttribute("data-id", m.id);
  
  el.innerHTML = `
    <span>${m.number}</span>
    <button class="marker-delete" data-id="${m.id}">✕</button>
    ${isActive ? `<input type="text" class="canvas-memo-input" value="${esc(m.note)}" placeholder="메모 입력...">` : (m.note ? `<div class="memo-label">${esc(m.note)}</div>` : "")}
  `;
  
  if (isActive) {
    const input = el.querySelector(".canvas-memo-input");
    setupCanvasInputSync(input, m);
  }
  const delBtn = el.querySelector(".marker-delete");
  delBtn.onclick = (e) => { e.stopPropagation(); deleteMarker(m.id, t); };
  
  setupBadgeEvents(el, m, t);
  markersLayer.appendChild(el);
}

function renderRegion(m, t) {
  const W = t.imageNaturalW * t.zoom, H = t.imageNaturalH * t.zoom;
  const isActive = state.activeMarkerId === m.id;
  const el = document.createElement("div");
  el.className = `region-box ${isActive ? "active" : ""}`;
  el.style.left = `${m.x1 * W}px`;
  el.style.top = `${m.y1 * H}px`;
  el.style.width = `${(m.x2 - m.x1) * W}px`;
  el.style.height = `${(m.y2 - m.y1) * H}px`;

  const regionColor = m.color || state.markerColor;
  
  if (isActive) el.style.boxShadow = `0 0 0 2px ${regionColor}`;
  el.setAttribute("data-id", m.id);
  
  if (isActive) {
    el.innerHTML = `
      <div class="region-badge" data-id="${m.id}" style="background:${regionColor};color:#000;">${m.number}</div>
      <button class="marker-delete" data-id="${m.id}">✕</button>
      <input type="text" class="canvas-memo-input" value="${esc(m.note)}" placeholder="메모 입력...">
      <div class="resize-handle" data-id="${m.id}" style="background:${regionColor};"></div>
    `;
    const input = el.querySelector(".canvas-memo-input");
    setupCanvasInputSync(input, m);
    const delBtn = el.querySelector(".marker-delete");
    delBtn.onclick = (e) => { e.stopPropagation(); deleteMarker(m.id, t); };
    delBtn.onpointerdown = (e) => e.stopPropagation();
    delBtn.onmousedown = (e) => e.stopPropagation();
  } else {
    el.innerHTML = `
      <div class="region-badge" data-id="${m.id}" style="background:${regionColor};color:#000;">${m.number}</div>
      <button class="marker-delete" data-id="${m.id}">✕</button>
      ${m.note ? `<div class="memo-label">${esc(m.note)}</div>` : ""}
      <div class="resize-handle" data-id="${m.id}" style="background:${regionColor};"></div>
    `;
    const delBtn = el.querySelector(".marker-delete");
    delBtn.onclick = (e) => { e.stopPropagation(); deleteMarker(m.id, t); };
    delBtn.onpointerdown = (e) => e.stopPropagation();
    delBtn.onmousedown = (e) => e.stopPropagation();
  }
  setupBadgeEvents(el.querySelector(".region-badge"), m, t);
  markersLayer.appendChild(el);
}

function deleteMarker(mid, t) {
  if (!t) return;
  saveHistory();
  t.markers = t.markers.filter(x => x.id !== mid);
  t.markers.forEach((x, i) => x.number = i + 1);
  if (state.activeMarkerId === mid) state.activeMarkerId = null;
  renderMarkers(); updateMarkerList(); persist();
}

function setupCanvasInputSync(input, m) {
  input.oninput = () => {
    m.note = input.value;
    // Sync to sidebar without full re-render
    const sideInputs = document.querySelectorAll(`.marker-item .memo-input`);
    const sideItem = Array.from(document.querySelectorAll('.marker-item')).find(item => item.querySelector('.num').textContent == m.number);
    if (sideItem) {
      const sideInput = sideItem.querySelector('.memo-input');
      if (sideInput) sideInput.value = input.value;
    }
    persist();
  };
  input.onmousedown = e => e.stopPropagation();
  input.onpointerdown = e => e.stopPropagation();
  input.onclick = e => e.stopPropagation();
  input.onkeydown = e => { if (e.key === "Enter") input.blur(); };
  
  // Auto focus if newly created or selected
  if (state.shouldFocusMemo) {
    setTimeout(() => { if (input) { input.focus(); input.select(); } state.shouldFocusMemo = false; }, 50);
  }
}

function setupBadgeEvents(el, m, t) {
  el.onpointerdown = e => e.stopPropagation();
  el.onclick = e => { 
    e.stopPropagation(); 
    if (state.activeMarkerId === m.id && !state.shouldFocusMemo) {
       const canvasInput = document.querySelector(`.canvas-memo-input`);
       if (canvasInput) canvasInput.focus();
    } else {
       state.activeMarkerId = m.id;
       state.shouldFocusMemo = true;
       // Sync color wheel to this marker's color
       const mColor = m.color || state.markerColor;
       syncColorWheelTo(mColor);
       renderMarkers();
       updateMarkerList();
    }
  };
}

function showTooltip(target, m) {
  const tt = document.createElement("div");
  tt.className = "marker-tooltip";
  tt.innerHTML = `
    <input type="text" value="${esc(m.note)}" placeholder="메모 입력...">
    <div class="tooltip-actions">
      <button class="del-btn">✕</button>
    </div>
  `;
  document.body.appendChild(tt);
  const rect = target.getBoundingClientRect();
  tt.style.left = `${rect.left + rect.width/2}px`; tt.style.top = `${rect.top - 10}px`;
  
  const input = tt.querySelector("input");
  input.focus();
  input.oninput = () => { m.note = input.value; updateMarkerList(); persist(); };
  tt.querySelector(".del-btn").onclick = () => {
    const t = current(); if (!t) return;
    saveHistory();
    t.markers = t.markers.filter(x => x.id !== m.id);
    t.markers.forEach((x, i) => x.number = i + 1);
    tt.remove(); renderMarkers(); updateMarkerList(); persist();
  };
  
  const hide = (e) => { 
    if (!tt.contains(e.target) && e.target !== target) { 
      tt.remove(); document.removeEventListener("pointerdown", hide); 
    } 
  };
  setTimeout(() => document.addEventListener("pointerdown", hide), 10);
}

function updateMarkerList() {
  const t = current(); if (!t) return;
  markerList.innerHTML = "";
  if (t.markers.length === 0) {
    markerList.innerHTML = `<div class="empty">마커가 없습니다</div>`;
    return;
  }
  t.markers.forEach(m => {
    const el = document.createElement("div");
    const mColor = m.color || state.markerColor || "#ff5f56";
    el.className = `marker-item ${state.activeMarkerId === m.id ? "active" : ""}`;
    if (state.activeMarkerId === m.id) el.style.borderColor = mColor;
    el.innerHTML = `
      <span class="num" style="background:${mColor};color:#fff;">${m.number}</span>
      <input type="text" class="memo-input" value="${esc(m.note || "")}" placeholder="메모 입력...">
      <button class="del-btn" title="삭제">✕</button>
    `;
    
    const input = el.querySelector(".memo-input");
    input.oninput = () => { m.note = input.value; renderMarkers(); persist(); };
    input.onkeydown = e => { if (e.key === "Enter") input.blur(); };
    input.onclick = (e) => e.stopPropagation();
    input.onpointerdown = (e) => e.stopPropagation();
    input.onmousedown = (e) => e.stopPropagation();

    if (state.activeMarkerId === m.id && state.shouldFocusMemo) {
      setTimeout(() => { if (input) { input.focus(); input.select(); } state.shouldFocusMemo = false; }, 50);
    }

    el.querySelector(".del-btn").onclick = (e) => {
      e.stopPropagation();
      deleteMarker(m.id, t);
    };

    el.onclick = () => { 
      state.activeMarkerId = m.id; 
      // Update color wheel to match marker color
      const mColor = m.color || state.markerColor;
      syncColorWheelTo(mColor);
      renderMarkers(); updateMarkerList(); 
    };
    markerList.appendChild(el);
  });
}

function drawTexturedPath(ctx, m, img, scale = 1) {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!m.points || m.points.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = m.color;
  ctx.lineWidth = (m.width || 4) * scale;

  if (m.tool === "sketch") {
    // Pencil: Thin, graphite look with slight grain
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(m.points[0].x * W, m.points[0].y * H);
    for (let i = 1; i < m.points.length; i++) {
      ctx.lineTo(m.points[i].x * W, m.points[i].y * H);
    }
    ctx.stroke();
    // Second pass for grain
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = (m.width || 4) * 1.2 * scale;
    ctx.setLineDash([1 * scale, 2 * scale]);
    ctx.stroke();
  } else if (m.tool === "draw") {
    // Brush (Pen style): Clean solid line
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.moveTo(m.points[0].x * W, m.points[0].y * H);
    for (let i = 1; i < m.points.length; i++) {
        ctx.lineTo(m.points[i].x * W, m.points[i].y * H);
    }
    ctx.stroke();
  } else if (m.tool === "highlight") {
    // Crayon: Textured stamp method
    ctx.globalAlpha = 0.7;
    const size = (m.width || 4) * 1.2 * scale;
    const step = size / 4;
    
    for (let i = 0; i < m.points.length - 1; i++) {
        const p1 = { x: m.points[i].x * W, y: m.points[i].y * H };
        const p2 = { x: m.points[i+1].x * W, y: m.points[i+1].y * H };
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        
        for (let j = 0; j < dist; j += step) {
            const tx = p1.x + Math.cos(angle) * j;
            const ty = p1.y + Math.sin(angle) * j;
            
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(Math.random() * Math.PI * 2);
            ctx.fillStyle = m.color;
            ctx.beginPath();
            // Create a randomized "waxy" stamp
            for (let a = 0; a < Math.PI * 2; a += 0.8) {
                const r = (size / 2) * (0.7 + Math.random() * 0.6);
                const ax = Math.cos(a) * r;
                const ay = Math.sin(a) * r;
                if (a === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
            }
            ctx.fill();
            ctx.restore();
        }
    }
  }
  ctx.restore();
}

function drawToCanvas() {
  const t = current(); if (!t || !t.imageDataUrl) return null;
  const canvas = document.createElement("canvas");
  const img = mainImage;
  const rotation = t.rotation || 0;
  
  if (rotation === 90 || rotation === 270) {
    canvas.width = img.naturalHeight; canvas.height = img.naturalWidth;
  } else {
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  }
  
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  
  // We need to draw markers. Since markers are stored in 0..1 relative to ORIGINAL image size,
  // and we just rotated the image, we need to decide if we draw markers on top of the rotated image
  // or before rotation. Most intuitive is to draw them on top of what the user sees.
  // However, the current marker coordinates are relative to the original image orientation.
  
  t.markers.forEach(m => {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-img.naturalWidth / 2, -img.naturalHeight / 2);
    
    const markerColor = m.color || state.markerColor || "#3dfc64";
    const scale = 1 / (t.zoom || 1);
    const strokeWidth = (m.width || state.strokeWidth || 4) * scale;
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = strokeWidth;
    
    if (m.type === "point" || m.type === "region") {
        const W = img.naturalWidth, H = img.naturalHeight;
        
        if (m.type === "point") {
          // Render Marker Circle (Badge)
          ctx.translate(m.x * W, m.y * H);
          ctx.scale(scale, scale);
          
          ctx.fillStyle = markerColor;
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, Math.PI * 2);
          ctx.fill();
          
          // White border around circle
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Number
          ctx.fillStyle = "#fff";
          ctx.font = "bold 12px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(m.number, 0, 0);
          
          // Memo Label (Glassmorphism style)
          if (m.note) {
            renderCanvasMemo(ctx, m.note, 18, -15, markerColor);
          }
        } else {
          // Region Box
          ctx.setLineDash([8 * scale, 4 * scale]);
          ctx.strokeStyle = markerColor;
          ctx.lineWidth = 2 * scale;
          const x1 = m.x1 * W, y1 = m.y1 * H;
          const x2 = m.x2 * W, y2 = m.y2 * H;
          ctx.strokeRect(x1, y1, x2-x1, y2-y1);
          ctx.setLineDash([]); // Reset dash
          
          // Region Badge (Circle)
          ctx.translate(x1, y1);
          ctx.scale(scale, scale);
          
          ctx.fillStyle = markerColor;
          ctx.beginPath(); ctx.arc(0, -20, 11, 0, Math.PI*2); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2; ctx.stroke();
          
          ctx.fillStyle = "#fff"; ctx.font = "bold 11px 'Inter', sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(m.number, 0, -20);
          
          if (m.note) {
            renderCanvasMemo(ctx, m.note, 25, -35, markerColor);
          }
        }
    } else if (m.type === "path") {
        drawTexturedPath(ctx, m, img, scale);
    } else if (m.type === "shape") {
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = strokeWidth;
        const x1 = m.x1 * img.naturalWidth, y1 = m.y1 * img.naturalHeight;
        const x2 = m.x2 * img.naturalWidth, y2 = m.y2 * img.naturalHeight;
        if (m.shapeType === "rect") {
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (m.shapeType === "circle") {
            ctx.beginPath();
            ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (m.shapeType === "arrow") {
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = 20 * scale;
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
        }
    }
    ctx.restore();
  });
  return canvas;
}

function renderCanvasMemo(ctx, text, x, y, markerColor) {
  ctx.save();
  ctx.font = "600 13px 'Inter', sans-serif";
  const tw = ctx.measureText(text).width;
  const paddingH = 12, paddingV = 6;
  const bw = tw + paddingH * 2, bh = 24;
  
  // Background (Dark Glass)
  ctx.fillStyle = "rgba(35, 40, 50, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 10);
  ctx.fill();
  
  // Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Text
  ctx.fillStyle = markerColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + paddingH, y + bh/2);
  ctx.restore();
}


async function copyAnnotatedImage() {
  const canvas = drawToCanvas();
  if (!canvas || !navigator.clipboard?.write) return;
  canvas.toBlob(blob => {
    if (blob) {
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("이미지가 클립보드에 복사되었습니다! 📋");
    }
  });
}

function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div"); t.id = "toast"; t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}


// ── Zoom Logic ──
function applyZoom() {
  const t = current(); if (!t || !t.imageNaturalW) return;
  const w = t.imageNaturalW * t.zoom, h = t.imageNaturalH * t.zoom;
  const rotation = t.rotation || 0;
  
  mainImage.style.width = `${w}px`; 
  mainImage.style.height = `${h}px`;
  
  // If rotated 90 or 270, we need to adjust the container's physical layout size
  if (rotation === 90 || rotation === 270) {
      imageContainer.style.width = `${h}px`; 
      imageContainer.style.height = `${w}px`;
      
      // Center the rotated image and markers inside the swapped container
      mainImage.style.position = "absolute";
      mainImage.style.left = "50%";
      mainImage.style.top = "50%";
      mainImage.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      
      markersLayer.style.width = `${w}px`; 
      markersLayer.style.height = `${h}px`;
      markersLayer.style.position = "absolute";
      markersLayer.style.left = "50%";
      markersLayer.style.top = "50%";
      markersLayer.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      markersLayer.style.transformOrigin = "center";
  } else {
      mainImage.style.transform = "";
      mainImage.style.position = "static";
      imageContainer.style.width = `${w}px`;
      imageContainer.style.height = `${h}px`;
      markersLayer.style.width = `${w}px`; markersLayer.style.height = `${h}px`;
      markersLayer.style.transform = "";
      markersLayer.style.position = "absolute";
      markersLayer.style.left = "0";
      markersLayer.style.top = "0";
  }
  
  zoomLevel.textContent = `${Math.round(t.zoom * 100)}%`;
  renderMarkers(); persist();
}


// ── Event Listeners ──
document.getElementById("selectFileBtn").onclick = () => fileInput.click();
fileInput.onchange = e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); };
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadImageFile(f); });
window.addEventListener("paste", e => { const item = e.clipboardData.items[0]; if (item?.type.startsWith("image/")) loadImageFile(item.getAsFile()); });

document.getElementById("zoomInBtn").onclick = () => { const t = current(); if (t) { t.zoom = Math.min(4, t.zoom*1.2); applyZoom(); } };
document.getElementById("zoomOutBtn").onclick = () => { const t = current(); if (t) { t.zoom = Math.max(0.1, t.zoom/1.2); applyZoom(); } };
document.getElementById("fitBtn").onclick = () => { const t = current(); if (t) {
  const wr = document.getElementById("canvasWrapper").getBoundingClientRect();
  t.zoom = Math.min((wr.width - 80) / t.imageNaturalW, (wr.height - 80) / t.imageNaturalH, 1);
  applyZoom();
}};
document.getElementById("clearBtn").onclick = () => { const t = current(); if (t) { saveHistory(); t.markers = []; renderMarkers(); updateMarkerList(); persist(); } };
document.getElementById("undoBtn").onclick = () => { const t = current(); if (t && t.history.length) { t.markers = t.history.pop(); renderMarkers(); updateMarkerList(); persist(); } };
const floatingHelpBtn = document.getElementById("floatingHelpBtn");
if (floatingHelpBtn) {
  floatingHelpBtn.onclick = () => { instructionModal.style.display = "flex"; };
}
document.getElementById("exportImageBtn").onclick = () => {
  const canvas = drawToCanvas(); if (!canvas) return;
  const a = document.createElement("a"); a.download = "snipmark_export.png"; a.href = canvas.toDataURL("image/png"); a.click();
};

newTabBtn.onclick = () => { const t = createTab(`탭 ${state.tabs.filter(x=>!x.closed).length+1}`); state.tabs.push(t); switchTab(t.id); };
reopenTabBtn.onclick = reopenLastClosedTab;

closeModalBtn.onclick = () => { instructionModal.style.display = "none"; persist(); };
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); document.getElementById("undoBtn").click(); }
  if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
    const tab = current();
    if (tab?.imageDataUrl) {
      const active = document.activeElement;
      const isInput = active.tagName === "INPUT" || active.tagName === "TEXTAREA";
      const hasSelection = isInput && active.selectionStart !== active.selectionEnd;
      if (!hasSelection) {
        e.preventDefault();
        // 1. Copy image to system clipboard (Priority)
        copyAnnotatedImage();
        
        // 2. Also copy marker data internally if one is active
        if (state.activeMarkerId) {
          const marker = tab.markers.find(m => m.id === state.activeMarkerId);
          if (marker) {
            state.copiedMarker = JSON.parse(JSON.stringify(marker));
          }
        }
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "v" || e.key === "V")) {
    const tab = current();
    const active = document.activeElement;
    const isInput = active.tagName === "INPUT" || active.tagName === "TEXTAREA";
    if (!isInput && state.copiedMarker && tab?.imageDataUrl) {
      e.preventDefault();
      saveHistory();
      const newMarker = JSON.parse(JSON.stringify(state.copiedMarker));
      newMarker.id = nowId();
      
      // Offset position slightly
      const offset = 0.05; 
      if (newMarker.type === "point") {
        newMarker.x = clamp(newMarker.x + offset);
        newMarker.y = clamp(newMarker.y + offset);
      } else if (newMarker.type === "region" || newMarker.type === "shape" || newMarker.type === "path") {
        if (newMarker.x1 !== undefined) {
          newMarker.x1 = clamp(newMarker.x1 + offset);
          newMarker.y1 = clamp(newMarker.y1 + offset);
          newMarker.x2 = clamp(newMarker.x2 + offset);
          newMarker.y2 = clamp(newMarker.y2 + offset);
        }
        if (newMarker.points) {
          newMarker.points = newMarker.points.map(p => ({ x: clamp(p.x + offset), y: clamp(p.y + offset) }));
        }
      }
      tab.markers.push(newMarker);
      state.activeMarkerId = newMarker.id;
      updateMarkerList();
      renderMarkers();
      persist();
      showToast("마커가 붙여넣기 되었습니다! ✨");
    }
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    document.getElementById("zoomInBtn").click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "-") {
    e.preventDefault();
    document.getElementById("zoomOutBtn").click();
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "0")) {
    e.preventDefault();
    document.getElementById("fitBtn").click();
  }
});

// Custom Wheel/Pinch Zoom for Canvas
canvasWrapper.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const t = current();
    if (!t) return;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    t.zoom = Math.min(4, Math.max(0.1, t.zoom * delta));
    applyZoom();
  }
}, { passive: false });

// Prevent generic browser zoom on the whole page via pinch
window.addEventListener("wheel", (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

// ── Spacebar Panning Logic ──
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !state.isSpacePressed) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    state.isSpacePressed = true;
    document.body.classList.add("panning");
    // Prevent scrolling with spacebar globally (except in inputs)
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    state.isSpacePressed = false;
    document.body.classList.remove("panning");
  }
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const t = current(); if (!t) return;
    t.imageDataUrl = reader.result;
    t.fileName = file.name;
    t.title = t.fileName.replace(/\.[^.]+$/, "");
    t.markers = []; t.history = []; t.autoFitPending = true;
    switchTab(t.id);
  };
  reader.readAsDataURL(file);
}

// ── (Auto Feature Removed) ──

// ── (Signature feature removed) ──


// ── TOOL INITIALIZATION ──
document.querySelectorAll(".tool-btn").forEach(btn => {
  btn.onclick = () => {
    if (btn.id === "toolShapeBtn") return; // Handled by dropdown
    const tool = btn.id.replace("tool", "").replace("Btn", "").toLowerCase();
    setTool(tool);
  };
});

document.querySelectorAll(".dropdown-content button[data-shape]").forEach(btn => {
  btn.onclick = (e) => {
    e.stopPropagation();
    setTool(btn.getAttribute("data-shape"));
    closeAllDropdowns();
  };
});

// ── COLOR PICKER INITIALIZATION ──
const colorWheelDropdown = document.querySelector("#colorWheelDropdown");
const colorWheelCanvas = document.querySelector("#colorWheelCanvas");
const colorWheelCursor = document.querySelector("#colorWheelCursor");
const lightnessSlider = document.querySelector("#lightnessSlider");

let isWheelDragging = false;
let currentHSL = { h: 140, s: 76, l: 50 }; // Default marker green

function initColorWheel() {
  if (!colorWheelCanvas) return;
  const ctx = colorWheelCanvas.getContext('2d');
  const width = colorWheelCanvas.width;
  const radius = width / 2;

  // Draw HSL color wheel
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const sat = (dist / radius) * 100;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, 50%)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  
  // Set initial color and cursor
  updateColorFromHSL();
}

function hexToHSL(hex) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16); g = parseInt(hex.slice(3, 5), 16); b = parseInt(hex.slice(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function parseColorToHSL(color) {
  if (!color) return null;
  if (color.startsWith("hsl")) {
    const match = color.match(/hsl\((\d+\.?\d*),\s*(\d+\.?\d*)%,\s*(\d+\.?\d*)%\)/);
    if (match) return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
  } else if (color.startsWith("#")) {
    return hexToHSL(color);
  }
  return null;
}

function syncColorWheelTo(color) {
  const hsl = parseColorToHSL(color);
  if (hsl) {
    currentHSL = hsl;
    updateColorFromHSL();
  }
}

function updateColorFromHSL() {
  const { h, s, l } = currentHSL;
  const color = `hsl(${h}, ${s}%, ${l}%)`;
  
  // Always update global defaults so next markings follow the picked color
  state.markerColor = color;
  state.strokeColor = color;

  if (state.currentTool === "select" && state.activeMarkerId) {
    const t = current();
    const m = t?.markers.find(x => x.id === state.activeMarkerId);
    if (m) {
      m.color = color;
      renderMarkers();
    }
  }
  
  activeColorBtn.style.background = color;
  if (sideMarkerColorBtn) sideMarkerColorBtn.style.background = color;
  
  // Update cursor position
  const radius = colorWheelCanvas.width / 2;
  const angle = (h * Math.PI) / 180;
  const dist = (s / 100) * radius;
  colorWheelCursor.style.left = `${radius + Math.cos(angle) * dist}px`;
  colorWheelCursor.style.top = `${radius + Math.sin(angle) * dist}px`;
  
  // Update slider gradient to show current H/S with varying lightness
  lightnessSlider.style.background = `linear-gradient(to right, #000, hsl(${h}, ${s}%, 50%), #fff)`;
  
  persist();
}

function handleWheelInteraction(e) {
  const rect = colorWheelCanvas.getBoundingClientRect();
  const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
  const radius = colorWheelCanvas.width / 2;
  const dx = x - radius;
  const dy = y - radius;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist <= radius || isWheelDragging) {
    const clampedDist = Math.min(dist, radius);
    currentHSL.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    currentHSL.s = (clampedDist / radius) * 100;
    updateColorFromHSL();
  }
}

if (activeColorBtn && colorWheelDropdown) {
  activeColorBtn.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = colorWheelDropdown.parentElement.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) colorWheelDropdown.parentElement.classList.add("open");
  };

  colorWheelCanvas.onmousedown = (e) => {
    isWheelDragging = true;
    handleWheelInteraction(e);
  };
  
  window.addEventListener('mousemove', (e) => {
    if (isWheelDragging) handleWheelInteraction(e);
  });
  
  window.addEventListener('mouseup', () => {
    isWheelDragging = false;
  });
  
  lightnessSlider.oninput = (e) => {
    currentHSL.l = e.target.value;
    updateColorFromHSL();
  };
  
  initColorWheel();
}

strokeWidthSelect.onchange = () => {
  state.strokeWidth = parseInt(strokeWidthSelect.value);
};

// ── CLICK-BASED DROPDOWNS ──
function closeAllDropdowns() {
  document.querySelectorAll(".tool-dropdown.open").forEach(d => d.classList.remove("open"));
  document.querySelectorAll(".color-picker.open").forEach(d => d.classList.remove("open"));
}

// Dropdown toggle for shapes
document.querySelector("#toolShapeBtn").onclick = (e) => {
  e.stopPropagation();
  const dd = e.currentTarget.closest(".tool-dropdown");
  const wasOpen = dd.classList.contains("open");
  closeAllDropdowns();
  if (!wasOpen) dd.classList.add("open");
};

// Close dropdowns when clicking outside
document.addEventListener("click", closeAllDropdowns);

// Prevent dropdown content clicks from closing the menu prematurely
document.querySelectorAll(".dropdown-content").forEach(el => {
  el.addEventListener("click", e => e.stopPropagation());
});

function setTool(tool) {
  state.currentTool = tool;
  document.querySelectorAll(".tool-btn").forEach(b => {
    const bTool = b.id.replace("tool", "").replace("Btn", "").toLowerCase();
    // Special handling for nested tools
    const isActive = bTool === tool || 
                     (b.id === "toolShapeBtn" && ["rect", "circle", "arrow"].includes(tool)) ||
                     (b.id === "toolSignatureBtn" && tool === "signature");
    b.classList.toggle("active", isActive);
  });
  
  // Show/Hide style group based on tool
  const styleGroup = document.querySelector(".style-group");
  const needsStyles = ["sketch", "draw", "highlight", "rect", "circle", "arrow", "signature"].includes(tool);
  const isSelectWithMarker = tool === "select"; // Always show in select mode for marker defaults/active marker
  styleGroup.style.display = (needsStyles || isSelectWithMarker) ? "flex" : "none";
  
  if (tool === "select") {
    imageContainer.style.cursor = "default";
  } else if (["sketch", "draw", "highlight"].includes(tool)) {
    imageContainer.style.cursor = "crosshair";
  } else {
    imageContainer.style.cursor = "crosshair";
  }
}

rotateBtn.onclick = () => rotateImage();

function rotateImage() {
  const t = current(); if (!t) return;
  t.rotation = ((t.rotation || 0) + 90) % 360;
  applyZoom();
  persist();
}

// Ensure first tab has rotation if not present
if (!state.tabs.some(t => t.rotation !== undefined)) {
    state.tabs.forEach(t => t.rotation = 0);
}

themeToggleBtn.onclick = () => {
    const next = state.theme === "dark" ? "light" : "dark";
    applyTheme(next);
};

if (sideMarkerColorBtn) {
  sideMarkerColorBtn.onclick = (e) => {
    e.stopPropagation();
    // Ensure toolbar is visible
    if (annotationToolbar.style.display === "none") {
      annotationToolbar.style.display = "flex";
    }
    setTool("select");
    state.activeMarkerId = null;
    syncColorWheelTo(state.markerColor);
    const wasOpen = colorWheelDropdown.parentElement.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) colorWheelDropdown.parentElement.classList.add("open");
  };
}

if (!restore()) ensureOneOpenTab();
initTheme();
setTool("select"); // Initialize tool state
applyModeUI();
renderTabs();
renderFromTab();


// Update main keydown for global shortcuts
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Escape logic if any remains
  }
});

// ── Ad System Integration ──
const AD_SERVER_URL = "http://localhost:3000";
const AD_REFRESH_INTERVAL = 5 * 60 * 1000; // 5분마다 새 광고

(function initAdSystem() {
  const adBanner = document.getElementById("adBanner");
  const adImage = document.getElementById("adImage");
  const adFallback = document.getElementById("adFallback");
  if (!adBanner || !adImage) return;

  let currentAdId = null;

  async function loadAd() {
    try {
      const res = await fetch(`${AD_SERVER_URL}/api/ads/active`);
      if (!res.ok) throw new Error("Ad fetch failed");
      const data = await res.json();

      if (data.ad) {
        const imgUrl = data.ad.imageUrl.startsWith("http")
          ? data.ad.imageUrl
          : `${AD_SERVER_URL}${data.ad.imageUrl}`;

        adImage.src = imgUrl;
        adImage.alt = data.ad.title || "Advertisement";
        adImage.style.display = "block";
        if (adFallback) adFallback.style.display = "none";

        adBanner.dataset.adId = data.ad.id;
        adBanner.dataset.clickUrl = data.ad.clickUrl || "";
        currentAdId = data.ad.id;

        // Record impression
        fetch(`${AD_SERVER_URL}/api/ads/impression`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adId: data.ad.id })
        }).catch(() => {});
      } else {
        adImage.style.display = "none";
        if (adFallback) adFallback.style.display = "block";
        currentAdId = null;
      }
    } catch (err) {
      // Server not available - show fallback
      adImage.style.display = "none";
      if (adFallback) adFallback.style.display = "block";
      currentAdId = null;
    }
  }

  // Click handler
  adBanner.addEventListener("click", async () => {
    const adId = adBanner.dataset.adId;
    const clickUrl = adBanner.dataset.clickUrl;
    if (!adId || !clickUrl) return;

    // Record click
    try {
      await fetch(`${AD_SERVER_URL}/api/ads/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId: Number(adId) })
      });
    } catch (e) {}

    // Open in external browser
    if (clickUrl) {
      if (typeof require !== "undefined") {
        try {
          const { shell } = require("electron");
          shell.openExternal(clickUrl);
        } catch {
          window.open(clickUrl, "_blank");
        }
      } else {
        window.open(clickUrl, "_blank");
      }
    }
  });

  // Initial load
  loadAd();

  // Refresh periodically
  setInterval(loadAd, AD_REFRESH_INTERVAL);
})();
