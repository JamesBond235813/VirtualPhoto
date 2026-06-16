/* ============================================================
   AI 照相馆 · 前端逻辑 v3（对话式创作 + 双主题，与后端 API 完全兼容）
   ============================================================ */

const state = {
  view: "cases",
  category: "all",
  user: JSON.parse(localStorage.getItem("prompt_user") || "null"),
  bootstrap: { categories: [], providers: [], prices: [], users: [] },
  cases: [],
  casesMeta: { total: 0, offset: 0, limit: 0, hasMore: false, loadingMore: false },
  caseReferenceGroups: [],
  caseReferenceCases: [],
  selectedCaseReferenceId: "",
  expandedCaseReferenceCategories: new Set(),
  activeCase: null,
  galleryLoaded: false,
  timeline: [],
  generating: false,
  generationMode: "text",
  referenceFiles: [],
  referenceVideos: [],
  wizard: { providerId: null, models: [], busy: false },
  histFilter: { granularity: "day", from: "", to: "" },
  creationFilter: "all",
  creationQuery: { userId: "all", from: "", to: "" },
  creationsCache: [],
  promptLanguages: {},
  promptTranslations: {},
  translatingPrompts: {},
};

const CASE_PAGE_SIZE = 240;
const PROMPT_INPUT_MIN_HEIGHT = 52;
const PROMPT_INPUT_MAX_HEIGHT = 190;
const VIDEO_MAX_POLL_ATTEMPTS = 240;
const BEIJING_TIME_ZONE = "Asia/Shanghai";
let nextCaseNumberRequest = 0;
const BEIJING_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const maskState = {
  drawing: false,
  strokes: [],
};

const $ = (selector) => document.querySelector(selector);

const VIEW_META = {
  cases: { eyebrow: "Gallery", title: "案例库", sub: "优秀生图案例与 Prompt，一键带入创作" },
  studio: { eyebrow: "Generate", title: "AI 生成", sub: "对话式创作，生成结果仅保留在当前会话" },
  account: { eyebrow: "Accounts", title: "用户与充值", sub: "管理用户账户与余额" },
  settings: { eyebrow: "Providers", title: "供应商与定价", sub: "接入 OpenAI 兼容接口并配置模型价格" },
  finance: { eyebrow: "Pay", title: "支付", sub: "支付渠道配置 · 收支流水 · 站点余额与提现" },
  billing: { eyebrow: "Billing", title: "账单", sub: "充值与消费明细，一目了然" },
  history: { eyebrow: "Gallery", title: "创作历史", sub: "你的每一次创作都在这里" },
};

const AUTHORIZATION_STATEMENT =
  "授权声明：我确认已获得照片中所有可识别人物的明确授权。照片人物均为成年人。授权范围包括将其肖像作为面部与气质参考，用于本次 AI 图片生成、风格化写真、换装、场景重构和艺术化精修。生成内容不得用于冒充真实事件、虚假代言、欺骗传播、色情化、侮辱化、违法用途或损害本人名誉的场景。";

const PROMPT_OPTIONS = {
  promptAspect: ["1:1 方图", "3:4 竖图", "4:3 横图", "9:16 手机竖屏", "16:9 横屏海报", "2:3 电商竖版"],
  promptStyle: ["写实摄影", "商业产品摄影", "电影感", "杂志封面", "3D 渲染", "水彩插画", "扁平矢量", "赛博朋克", "极简主义", "国风工笔"],
  promptQuality: ["高清细节", "4K", "8K", "超写实", "干净锐利", "高端质感", "无水印无 logo"],
  promptPalette: ["暖色调", "冷色调", "黑金配色", "低饱和莫兰迪", "高饱和活力色", "奶油色系", "品牌主色突出"],
  promptLighting: ["柔和自然光", "棚拍柔光", "黄金时刻", "逆光轮廓光", "戏剧性侧光", "霓虹光", "高对比明暗"],
  promptEnvironment: ["纯色背景", "高级影棚", "生活方式场景", "城市街头", "自然户外", "未来科技空间", "电商白底"],
  promptComposition: ["居中构图", "三分法构图", "俯拍", "低角度仰拍", "特写镜头", "广角全景", "浅景深主体突出"],
};

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const expectsJson = path.startsWith("/api/");
  if (expectsJson && !contentType.includes("application/json")) {
    throw new Error(formatNonJsonApiError(response.status));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function formatNonJsonApiError(status) {
  if (status === 504) return "网关超时：上游模型响应过慢，请稍后重试或换一个模型";
  if (status === 502) return "服务连接中断：服务刚重启或上游连接断开，请稍后重试";
  if (status === 413) return "上传文件过大，请压缩图片后重试";
  return `接口返回异常（HTTP ${status || "未知"}），请稍后重试`;
}

async function init() {
  initTheme();
  initParticles();
  initGlobalFluid();
  document.body.dataset.view = state.view;
  bindEvents();
  showGallerySkeleton();
  renderTimeline();
  restoreLastView();
  await refreshBootstrap();
  await Promise.all([loadCaseReferences(), refreshCases()]);
  renderUser();
  renderAll();
}

/* ---------- 主题 ---------- */
function initTheme() {
  const saved = localStorage.getItem("app_theme") || "light";
  applyTheme(saved);
  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("app_theme", next);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeIconDark").hidden = theme !== "dark";
  $("#themeIconLight").hidden = theme !== "light";
}

/* ---------- 粒子背景 ---------- */
function initParticles() {
  const field = $("#particleField");
  if (!field) return;
  const count = 26;
  let html = "";
  for (let i = 0; i < count; i += 1) {
    const size = (Math.random() * 3 + 1.5).toFixed(1);
    const left = (Math.random() * 100).toFixed(2);
    const duration = (Math.random() * 26 + 18).toFixed(1);
    const delay = (-Math.random() * 40).toFixed(1);
    const drift = ((Math.random() - 0.5) * 120).toFixed(0);
    const opacity = (Math.random() * 0.5 + 0.2).toFixed(2);
    html += `<span class="particle" style="width:${size}px;height:${size}px;left:${left}%;bottom:-2vh;--drift:${drift}px;animation-duration:${duration}s;animation-delay:${delay}s;opacity:${opacity}"></span>`;
  }
  field.innerHTML = html;
}

/* ---------- 事件绑定 ---------- */
// 容错绑定：元素缺失（如页面缓存与脚本版本错配）时仅告警，不中断初始化
function on(id, type, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(type, handler);
  else console.warn(`[bindEvents] 未找到元素 #${id}，已跳过绑定`);
}

function autoResizePromptInput() {
  const textarea = $("#studioPrompt");
  if (!textarea) return;
  textarea.style.height = `${PROMPT_INPUT_MIN_HEIGHT}px`;
  const nextHeight = Math.min(PROMPT_INPUT_MAX_HEIGHT, Math.max(PROMPT_INPUT_MIN_HEIGHT, textarea.scrollHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > PROMPT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
}

function resetPromptInputHeight() {
  const textarea = $("#studioPrompt");
  if (!textarea) return;
  textarea.style.height = `${PROMPT_INPUT_MIN_HEIGHT}px`;
  textarea.style.overflowY = textarea.scrollHeight > PROMPT_INPUT_MIN_HEIGHT ? "auto" : "hidden";
}

function setStudioPromptValue(value, { resize = true } = {}) {
  const textarea = $("#studioPrompt");
  if (!textarea) return;
  textarea.value = value || "";
  if (resize) autoResizePromptInput();
  else resetPromptInputHeight();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  // 用户弹窗 / 登录注册
  on("userChip", "click", () => {
    if (state.user) showUserDialog();
    else openAuthDialog();
  });
  on("closeUserDialog", "click", () => $("#userDialog").close());
  on("closeLoginDialog", "click", () => $("#userDialog").close());
  on("closeRegisterDialog", "click", () => $("#userDialog").close());
  on("authTabLogin", "click", () => setAuthTab("login"));
  on("authTabRegister", "click", () => setAuthTab("register"));
  on("sidebarLoginForm", "submit", login);
  on("registerForm", "submit", register);
  on("sendSmsButton", "click", sendSmsCode);
  on("logoutButton", "click", logout);

  // 案例库
  on("caseSearch", "input", debounce(refreshCases, 250));
  on("galleryLoadMore", "click", loadMoreCases);
  on("newCaseButton", "click", () => openCaseDialog());
  on("cancelCaseButton", "click", () => $("#caseDialog").close());
  on("caseForm", "submit", saveCase);
  bindCaseNumberAutomation();
  on("gallery", "click", handleCaseAction);
  on("caseDetailContent", "click", handleCaseAction);

  // 供应商向导 / 用户
  on("newProviderButton", "click", () => openProviderWizard());
  on("wizardCancelButton", "click", () => $("#providerWizard").close());
  on("wizardNextButton", "click", wizardNext);
  on("wizardBackButton", "click", () => setWizardStep(1));
  on("wizardSaveButton", "click", wizardSave);
  on("newUserButton", "click", () => {
    $("#createUserForm").reset();
    $("#userCreateDialog").showModal();
  });
  on("cancelUserCreate", "click", () => $("#userCreateDialog").close());
  on("cancelAdminRecharge", "click", () => $("#adminRechargeDialog").close());
  on("createUserForm", "submit", createUser);
  on("rechargeForm", "submit", recharge);

  // 创作
  on("generateButton", "click", generate);
  on("clearPromptButton", "click", clearStudio);
  on("derivePromptButton", "click", derivePromptFromUpload);
  on("derivedTabZh", "click", () => setDerivedLang("zh"));
  on("derivedTabEn", "click", () => setDerivedLang("en"));
  on("derivedCopyButton", "click", copyDerivedPrompt);
  on("derivedUseButton", "click", useDerivedPrompt);
  on("derivedCloseButton", "click", closeDerivedPanel);

  // 创作舞台操作
  on("stageZoomIn", "click", () => stageZoom(0.2));
  on("stageZoomOut", "click", () => stageZoom(-0.2));
  on("stageRotate", "click", stageRotate);
  on("stageReuse", "click", stageReusePrompt);
  on("stageDownload", "click", stageDownload);
  on("stageInpaint", "click", stageInpaint);
  on("stageClear", "click", clearStage);
  document.addEventListener("keydown", (event) => {
    if (state.view !== "studio" || stageState.status !== "done") return;
    if (document.querySelector("dialog[open]")) return;
    const tag = event.target?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (event.key === "+" || event.key === "=") stageZoom(0.2);
    else if (event.key === "-") stageZoom(-0.2);
    else if (event.key === "r" || event.key === "R") stageRotate();
    else if (event.key === "Escape") clearStage();
  });
  document.querySelectorAll("[data-generation-mode]").forEach((button) => {
    button.addEventListener("click", () => setGenerationMode(button.dataset.generationMode));
  });
  on("caseReferenceButton", "click", toggleCaseReferenceMenu);
  on("authorizationConfirmed", "change", syncAuthorizationStatement);
  on("referenceImage", "change", addReferenceFiles);
  on("clearMaskButton", "click", clearMaskCanvas);
  on("maskBrushSize", "input", renderMaskCanvas);
  bindMaskCanvasEvents();
  on("studioPrompt", "input", autoResizePromptInput);
  autoResizePromptInput();
  on("studioPrompt", "keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      generate();
    }
  });

  // 提示词辅助弹窗
  on("openPromptTools", "click", () => $("#promptToolsDialog").showModal());
  on("closePromptTools", "click", () => $("#promptToolsDialog").close());
  on("appendPromptHelperButton", "click", appendPromptHelper);
  on("composePromptHelperButton", "click", composePromptHelper);

  // 拖拽上传视觉反馈
  const dropzone = $("#dropzone");
  const fileInput = $("#referenceImage");
  if (dropzone && fileInput) {
    ["dragenter", "dragover"].forEach((type) =>
      fileInput.addEventListener(type, () => dropzone.classList.add("dragover"))
    );
    ["dragleave", "drop"].forEach((type) =>
      fileInput.addEventListener(type, () => dropzone.classList.remove("dragover"))
    );
  }

  // 灯箱
  on("lightboxClose", "click", () => $("#lightbox").close());
  on("lightbox", "click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  // 通用确认弹窗
  on("confirmOkButton", "click", () => $("#confirmDialog").close("ok"));
  on("confirmCancelButton", "click", () => $("#confirmDialog").close("cancel"));
  on("confirmDialog", "close", () => {
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve($("#confirmDialog").returnValue === "ok");
  });
  on("caseDetailDialog", "click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.addEventListener("click", (event) => {
    const control = $("#caseReferenceControl");
    if (control && !control.contains(event.target)) closeCaseReferenceMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCaseReferenceMenu();
  });
  window.addEventListener("resize", positionCaseReferenceMenu);

  // 支付与财务
  on("openRechargeButton", "click", () => openRechargeDialog());
  on("rcCancelButton", "click", () => $("#rechargeDialog").close());
  on("rcPayButton", "click", submitRecharge);
  on("rcAmount", "input", () => renderRechargeDialog());
  on("pgCancelButton", "click", () => $("#payQrDialog").close());
  on("pgPayButton", "click", submitPayPerGeneration);
  on("payQrCancelButton", "click", () => $("#payQrDialog").close());
  on("simulatePayButton", "click", simulatePayCurrent);
  on("payQrDialog", "close", stopPayPolling);
  on("withdrawButton", "click", () => {
    $("#wdAmount").value = "";
    $("#wdNote").value = "";
    $("#withdrawDialog").showModal();
  });
  on("wdCancelButton", "click", () => $("#withdrawDialog").close());
  on("wdSaveButton", "click", submitWithdrawal);
  on("ccCancelButton", "click", () => $("#channelConfigDialog").close());
  on("ccSaveButton", "click", saveChannelConfig);
  on("copyAlipayNotifyUrlButton", "click", () => copyCallbackUrl("alipay"));
  on("copyWechatNotifyUrlButton", "click", () => copyCallbackUrl("wechat"));

  // 历史页筛选
  on("histRechargeButton", "click", () => {
    if (!state.user) return openAuthDialog("登录后即可充值");
    openRechargeDialog();
  });
  on("histSearchButton", "click", () => {
    state.histFilter.from = $("#histFrom").value || "";
    state.histFilter.to = $("#histTo").value || "";
    if (state.histFilter.from && state.histFilter.to && state.histFilter.from > state.histFilter.to) {
      throwNotice("开始日期不能晚于结束日期");
    }
    renderHistory();
  });
  on("histResetButton", "click", () => {
    state.histFilter.from = "";
    state.histFilter.to = "";
    $("#histFrom").value = "";
    $("#histTo").value = "";
    renderHistory();
  });
  on("creationSearchButton", "click", () => {
    const userFilter = $("#creationUserFilter");
    state.creationQuery.userId = userFilter?.value || "all";
    state.creationQuery.from = $("#creationFrom").value || "";
    state.creationQuery.to = $("#creationTo").value || "";
    if (state.creationQuery.from && state.creationQuery.to && state.creationQuery.from > state.creationQuery.to) {
      throwNotice("开始日期不能晚于结束日期");
    }
    state.creationFilter = "all";
    renderHistory();
  });
  on("creationResetButton", "click", () => {
    state.creationQuery = { userId: "all", from: "", to: "" };
    state.creationFilter = "all";
    $("#creationFrom").value = "";
    $("#creationTo").value = "";
    if ($("#creationUserFilter")) $("#creationUserFilter").value = "all";
    renderHistory();
  });
}

function clearStudio() {
  setStudioPromptValue("", { resize: false });
  state.activeCase = null;
  state.selectedCaseReferenceId = "";
  updateCaseReferenceLabel();
  state.referenceFiles = [];
  state.referenceVideos = [];
  $("#referenceImage").value = "";
  $("#authorizationConfirmed").checked = false;
  $("#referencePreview").hidden = true;
  $("#referencePreview").innerHTML = "";
  clearMaskCanvas();
  updateMaskEditor();
  showNotice("创作输入已清空", "info");
}

async function refreshBootstrap() {
  state.bootstrap = await api("/api/bootstrap");
}

async function refreshCases() {
  showGallerySkeleton();
  state.cases = [];
  state.casesMeta = { total: 0, offset: 0, limit: CASE_PAGE_SIZE, hasMore: false, loadingMore: false };
  await fetchCasePage({ append: false, offset: 0 });
}

async function fetchCasePage({ append = false, offset = 0 } = {}) {
  const params = new URLSearchParams({
    category: state.category || "all",
    q: $("#caseSearch")?.value || "",
  });
  params.set("limit", String(CASE_PAGE_SIZE));
  params.set("offset", String(offset));
  const payload = await api(`/api/cases?${params}`);
  const items = Array.isArray(payload) ? payload : payload.items || [];
  state.cases = append ? [...state.cases, ...items] : items;
  state.casesMeta = {
    total: Number(Array.isArray(payload) ? items.length : payload.total || items.length),
    offset: Number(Array.isArray(payload) ? 0 : payload.offset || 0),
    limit: Number(Array.isArray(payload) ? items.length : payload.limit || CASE_PAGE_SIZE),
    hasMore: Boolean(!Array.isArray(payload) && payload.hasMore),
    loadingMore: false,
  };
  state.galleryLoaded = true;
  renderCases();
}

async function loadMoreCases() {
  if (state.casesMeta.loadingMore || !state.casesMeta.hasMore) return;
  state.casesMeta.loadingMore = true;
  renderGalleryLoadMore();
  try {
    await fetchCasePage({ append: true, offset: state.cases.length });
  } catch (error) {
    state.casesMeta.loadingMore = false;
    renderGalleryLoadMore();
    showNotice(`加载更多失败：${error.message}`, "error");
  }
}

async function loadCaseReferences() {
  state.caseReferenceGroups = await api("/api/case-references");
  state.caseReferenceCases = state.caseReferenceGroups.flatMap((group) =>
    group.cases.map((item) => ({ ...item, categoryId: group.id, categoryName: group.name }))
  );
  ensureDefaultCaseReferenceState();
  renderCaseReferenceMenu();
  updateCaseReferenceLabel();
}

function renderAll() {
  renderSelectors();
  renderCategoryChips();
  renderPromptTools();
  renderCases();
  renderSettings();
  renderUsers();
  renderHistory();
}

function isEnabledFlag(value) {
  return value === true || Number(value) === 1;
}

function isProviderEnabled(providerId) {
  return state.bootstrap.providers.some((provider) => Number(provider.id) === Number(providerId) && isEnabledFlag(provider.enabled));
}

function generationPrices() {
  return state.bootstrap.prices.filter((price) => isEnabledFlag(price.enabled) && isProviderEnabled(price.providerId));
}

function renderSelectors() {
  const categories = state.bootstrap.categories;
  $("#caseForm select[name=categoryId]").innerHTML = categories
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  const enabledPrices = generationPrices()
    .filter((price, index, prices) => prices.findIndex((item) => item.displayName === price.displayName) === index);
  $("#studioPrice").innerHTML = enabledPrices.length
    ? enabledPrices
        .map((p) => `<option value="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}</option>`)
        .join("")
    : `<option value="">尚未配置模型</option>`;
  renderCaseReferenceMenu();
  $("#categoryCount").textContent = state.bootstrap.categories.length;
  $("#providerCount").textContent = state.bootstrap.providers.length;
}

/* ---------- 推导提示词（图片反推） ---------- */
const derivedState = { en: "", zh: "", lang: "en", busy: false };

async function derivePromptFromUpload() {
  if (!state.user) {
    openAuthDialog("登录后即可使用「推导提示词」功能");
    return;
  }
  const file = state.referenceFiles[0];
  if (!file) throwNotice("请先上传图片，再点击「推导提示词」");
  if (derivedState.busy) return;

  const button = $("#derivePromptButton");
  derivedState.busy = true;
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = "推导中…";
  try {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("userId", state.user.id);
    const result = await api("/api/derive-prompt", { method: "POST", body: formData, headers: {} });
    derivedState.en = String(result.en || "").trim();
    derivedState.zh = String(result.zh || "").trim();
    derivedState.lang = derivedState.zh ? "zh" : "en";
    renderDerivedPanel();
    if (result.chargeCents > 0 && result.balanceCents != null) {
      state.user.balanceCents = result.balanceCents;
      localStorage.setItem("prompt_user", JSON.stringify(state.user));
      renderUser();
      renderHistory();
      showNotice(`提示词推导完成，扣费 ${money(result.chargeCents)}`, "success");
    } else {
      showNotice("提示词推导完成", "success");
    }
  } finally {
    derivedState.busy = false;
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}

function renderDerivedPanel() {
  const panel = $("#derivedPanel");
  if (!derivedState.en && !derivedState.zh) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const hasZh = Boolean(derivedState.zh);
  $("#derivedTabZh").hidden = !hasZh;
  $("#derivedTabZh").classList.toggle("active", derivedState.lang === "zh");
  $("#derivedTabEn").classList.toggle("active", derivedState.lang === "en");
  $("#derivedText").textContent = derivedState.lang === "zh" ? derivedState.zh : derivedState.en;
}

function setDerivedLang(lang) {
  if (lang === "zh" && !derivedState.zh) return;
  derivedState.lang = lang;
  renderDerivedPanel();
}

async function copyDerivedPrompt() {
  const text = derivedState.lang === "zh" ? derivedState.zh : derivedState.en;
  if (!text) return;
  await copyText(text);
  showNotice("推导的提示词已复制", "success");
}

function useDerivedPrompt() {
  const text = derivedState.lang === "zh" ? derivedState.zh : derivedState.en;
  if (!text) return;
  setStudioPromptValue(text);
  syncAuthorizationStatement();
  showNotice("已填入输入框", "success");
}

function closeDerivedPanel() {
  $("#derivedPanel").hidden = true;
}

function renderCategoryChips() {
  const chips = [{ id: "all", name: "全部分类" }, ...state.bootstrap.categories];
  $("#categoryChips").innerHTML = chips
    .map(
      (c) =>
        `<button class="chip ${String(state.category) === String(c.id) ? "active" : ""}" data-category="${c.id}">${escapeHtml(c.name)}</button>`
    )
    .join("");
  document.querySelectorAll("#categoryChips .chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      state.category = chip.dataset.category;
      renderCategoryChips();
      await refreshCases();
    });
  });
}

function showGallerySkeleton() {
  $("#gallery").innerHTML = Array.from({ length: 8 })
    .map(
      () => `
      <div class="skeleton-card">
        <div class="sk sk-img"></div>
        <div class="sk sk-line w60"></div>
        <div class="sk sk-line w85"></div>
      </div>`
    )
    .join("");
}

function renderCases() {
  $("#caseCount").textContent = state.casesMeta.total || state.cases.length;
  if (!state.cases.length && state.galleryLoaded) {
    $("#gallery").innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <strong>没有找到匹配的案例</strong>
        <p>换个关键词或分类试试，或点击右上角「新增案例」</p>
      </div>`;
  } else if (state.cases.length) {
    $("#gallery").innerHTML = state.cases.map(renderCaseCard).join("");
  }
  renderGalleryLoadMore();
  renderCaseReferenceMenu();
}

function renderGalleryLoadMore() {
  const button = $("#galleryLoadMore");
  const label = $("#galleryLoadMoreLabel");
  if (!button || !label) return;
  const loaded = state.cases.length;
  const total = state.casesMeta.total || loaded;
  button.hidden = !state.galleryLoaded || !state.casesMeta.hasMore;
  button.disabled = Boolean(state.casesMeta.loadingMore);
  label.textContent = state.casesMeta.loadingMore
    ? "加载中..."
    : `继续加载 ${loaded}/${total}`;
}

function renderCaseReferenceMenu() {
  const list = $("#caseReferenceList");
  if (!list) return;
  if (!state.caseReferenceGroups.length) {
    list.innerHTML = `<div class="case-reference-empty">暂无可参考案例</div>`;
    renderCaseReferencePreview(null);
    return;
  }
  list.innerHTML = state.caseReferenceGroups
    .map((group) => {
      const expanded = state.expandedCaseReferenceCategories.has(String(group.id));
      return `
        <div class="case-reference-group">
          <div class="case-reference-category ${expanded ? "active" : ""}" data-reference-category="${escapeHtml(group.id)}" aria-expanded="${expanded}">
            <span>${escapeHtml(group.name)}</span>
            <button class="case-reference-toggle" type="button" data-reference-toggle="${escapeHtml(group.id)}" aria-label="${expanded ? "收起" : "展开"}${escapeHtml(group.name)}明细" aria-expanded="${expanded}">
              <span class="case-reference-count">${group.cases.length}</span>
              <span class="case-reference-arrow">${expanded ? "⌄" : ">"}</span>
            </button>
          </div>
          <div class="case-reference-items" ${expanded ? "" : "hidden"}>
            ${group.cases
              .map(
                (item) => `
                <button class="case-reference-item ${String(state.selectedCaseReferenceId) === String(item.id) ? "active" : ""}" type="button" data-reference-case="${item.id}">
                  <span class="case-reference-number">Case ${escapeHtml(item.caseNumber || "-")}</span>
                  <span class="case-reference-title">${escapeHtml(item.title)}</span>
                </button>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");
  bindCaseReferenceMenuEvents();
  renderCaseReferencePreview(getCaseReferencePreviewItem());
}

function bindCaseReferenceMenuEvents() {
  document.querySelectorAll("[data-reference-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCaseReferenceCategory(button.dataset.referenceToggle);
    });
  });
  document.querySelectorAll("[data-reference-case]").forEach((button) => {
    const previewCase = () => renderCaseReferencePreview(findCaseReference(button.dataset.referenceCase));
    button.addEventListener("mouseenter", previewCase);
    button.addEventListener("mouseover", previewCase);
    button.addEventListener("pointerenter", previewCase);
    button.addEventListener("focus", () => {
      renderCaseReferencePreview(findCaseReference(button.dataset.referenceCase));
    });
    button.addEventListener("click", () => {
      selectCaseReference(button.dataset.referenceCase);
    });
  });
}

function toggleCaseReferenceCategory(id) {
  id = String(id);
  if (state.expandedCaseReferenceCategories.has(id)) {
    state.expandedCaseReferenceCategories.delete(id);
  } else {
    state.expandedCaseReferenceCategories = new Set([id]);
  }
  renderCaseReferenceMenu();
}

function getSelectedCaseReference() {
  return state.selectedCaseReferenceId ? findCaseReference(state.selectedCaseReferenceId) : null;
}

function ensureDefaultCaseReferenceState() {
  const firstGroup = state.caseReferenceGroups.find((group) => group.cases.length);
  if (!firstGroup) return;
  const expandedVisibleGroup = state.caseReferenceGroups.find(
    (group) => group.cases.length && state.expandedCaseReferenceCategories.has(String(group.id))
  );
  state.expandedCaseReferenceCategories = new Set([String((expandedVisibleGroup || firstGroup).id)]);
}

function getCaseReferencePreviewItem() {
  const selected = getSelectedCaseReference();
  if (selected) return selected;
  const expandedGroup = state.caseReferenceGroups.find(
    (group) => group.cases.length && state.expandedCaseReferenceCategories.has(String(group.id))
  );
  return expandedGroup?.cases[0] || state.caseReferenceCases[0] || null;
}

function findCaseReference(id) {
  return state.caseReferenceCases.find((caseItem) => Number(caseItem.id) === Number(id));
}

function renderCaseReferencePreview(item) {
  const preview = $("#caseReferencePreview");
  if (!preview) return;
  if (!item) {
    preview.innerHTML = `<div class="case-reference-preview-empty">悬停案例查看示例图</div>`;
    return;
  }
  const image = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" />`
    : `<div class="case-reference-preview-empty">暂无示例图</div>`;
  preview.innerHTML = `
    <div class="case-reference-preview-image">${image}</div>
    <div class="case-reference-preview-caption">
      <strong>Case ${escapeHtml(item.caseNumber || "-")}</strong>
      <span>${escapeHtml(item.title)}</span>
    </div>`;
}

function updateCaseReferenceLabel() {
  const label = $("#caseReferenceLabel");
  if (!label) return;
  const item = getSelectedCaseReference();
  label.textContent = item ? `Case ${item.caseNumber || "-"} · ${item.title}` : "案例参考";
}

function toggleCaseReferenceMenu(event) {
  event?.stopPropagation();
  const menu = $("#caseReferenceMenu");
  const button = $("#caseReferenceButton");
  if (!menu || !button) return;
  if (menu.hidden) {
    if (!state.caseReferenceGroups.length) {
      loadCaseReferences().catch((error) => showNotice(`案例参考加载失败：${error.message}`, "error"));
    }
    ensureDefaultCaseReferenceState();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    renderCaseReferenceMenu();
    positionCaseReferenceMenu();
  } else {
    closeCaseReferenceMenu();
  }
}

function positionCaseReferenceMenu() {
  const menu = $("#caseReferenceMenu");
  const button = $("#caseReferenceButton");
  if (!menu || !button || menu.hidden) return;
  const control = $("#caseReferenceControl");
  const composer = $(".composer-card");
  if (!control || !composer) return;
  const controlRect = control.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  const menuWidth = Math.min(616, window.innerWidth - 32);
  const availableRight = composerRect.right - controlRect.left;
  const shift = Math.min(0, availableRight - menuWidth);
  menu.style.setProperty("--case-reference-shift", `${shift}px`);
  menu.style.setProperty("--case-reference-width", `${menuWidth}px`);
}

function closeCaseReferenceMenu() {
  const menu = $("#caseReferenceMenu");
  const button = $("#caseReferenceButton");
  if (!menu || !button) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
  menu.style.removeProperty("--case-reference-shift");
  menu.style.removeProperty("--case-reference-width");
}

function selectCaseReference(id) {
  const item = findCaseReference(id);
  if (!item) return;
  state.selectedCaseReferenceId = String(item.id);
  state.activeCase = item;
  setStudioPromptValue(splitCasePromptText(item.prompt).original);
  syncAuthorizationStatement();
  updateCaseReferenceLabel();
  renderCaseReferenceMenu();
  closeCaseReferenceMenu();
  recordCaseUse(item.id, "reference");
  showNotice(`已带入「${item.title}」`, "success");
}

function renderPromptTools() {
  for (const [id, values] of Object.entries(PROMPT_OPTIONS)) {
    const select = $(`#${id}`);
    if (!select || select.options.length) continue;
    select.innerHTML = `<option value="">不指定</option>${values
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join("")}`;
  }
}

function renderCaseCard(item) {
  const image = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" data-case-action="lightbox" data-case-src="${escapeHtml(item.image)}" />`
    : `<span>暂无图片</span>`;
  const language = state.promptLanguages[item.id] || "original";
  const prompt = getCasePrompt(item);
  const translating = Boolean(state.translatingPrompts[item.id]);
  return `
    <article class="case-card">
      <div class="image-wrap">${image}</div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-cat">${escapeHtml(item.categoryName)}</span>
          <span class="badge badge-num">Case ${item.caseNumber || "-"}</span>
        </div>
        <div class="card-title-row">
          <h3>${escapeHtml(item.title)}</h3>
          <div class="prompt-lang-tabs" aria-label="提示词语言切换">
            <button class="lang-tab ${language === "original" ? "active" : ""}" type="button" data-case-action="language" data-case-id="${item.id}" data-case-language="original">原文</button>
            <button class="lang-tab ${language === "zh" ? "active" : ""}" type="button" data-case-action="language" data-case-id="${item.id}" data-case-language="zh" ${translating ? "disabled" : ""}>${translating ? "翻译中" : "中文"}</button>
          </div>
        </div>
        <p class="author">${escapeHtml(item.author || "Unknown")}</p>
        <div class="prompt-block">
          <pre class="prompt-pre" data-case-prompt="${item.id}">${escapeHtml(prompt)}</pre>
          <button class="prompt-toggle" type="button" data-case-action="detail" data-case-id="${item.id}">展开</button>
        </div>
        <div class="card-actions">
          <button class="btn-primary" type="button" data-case-action="use" data-case-id="${item.id}">带入创作</button>
          <button type="button" data-case-action="copy" data-case-id="${item.id}">复制</button>
          <button type="button" data-case-action="edit" data-case-id="${item.id}">编辑</button>
          <button class="danger" type="button" data-case-action="delete" data-case-id="${item.id}">删除</button>
        </div>
      </div>
    </article>`;
}

function handleCaseAction(event) {
  const target = event.target.closest("[data-case-action]");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const action = target.dataset.caseAction;
  const id = target.dataset.caseId;
  if (action === "lightbox") openLightbox(target.dataset.caseSrc);
  if (action === "detail") openCaseDetail(id);
  if (action === "use") usePrompt(id);
  if (action === "copy") copyPrompt(id);
  if (action === "edit") openCaseDialog(id);
  if (action === "delete") removeCase(id);
  if (action === "language") switchCasePromptLanguage(event, id, target.dataset.caseLanguage);
  if (action === "close-detail") closeCaseDetail();
}

function getCasePrompt(item) {
  const parts = splitCasePromptText(item.prompt);
  if ((state.promptLanguages[item.id] || "original") === "zh") {
    return parts.zh || state.promptTranslations[item.id] || parts.original;
  }
  return parts.original;
}

function splitCasePromptText(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return { original: "", zh: "" };
  const marker = text.match(/\n*\[(?:中文提示词|中文|zh|chinese(?: prompt)?)\]\s*\n?/i);
  if (!marker) return { original: text, zh: "" };
  const original = text.slice(0, marker.index).trim();
  const zh = text.slice(marker.index + marker[0].length).trim();
  return { original: original || text, zh };
}

function findCase(id) {
  return (
    state.cases.find((caseItem) => Number(caseItem.id) === Number(id)) ||
    findCaseReference(id)
  );
}

window.switchCasePromptLanguage = async function switchCasePromptLanguage(event, id, language) {
  event?.stopPropagation();
  const item = findCase(id);
  if (!item) return;

  if (language === "original") {
    state.promptLanguages[item.id] = "original";
    updateCasePromptCard(item);
    return;
  }

  state.promptLanguages[item.id] = "zh";
  const parts = splitCasePromptText(item.prompt);
  if (!parts.zh && !state.promptTranslations[item.id]) {
    state.translatingPrompts[item.id] = true;
    updateCasePromptCard(item);
    try {
      const result = await api("/api/translate", {
        method: "POST",
        body: JSON.stringify({ text: splitCasePromptText(item.prompt).original }),
      });
      state.promptTranslations[item.id] = result.text || parts.original;
    } catch (error) {
      state.promptLanguages[item.id] = "original";
      showNotice(`翻译失败：${error.message}`, "error");
    } finally {
      delete state.translatingPrompts[item.id];
    }
  }
  updateCasePromptCard(item);
};

function updateCasePromptCard(item) {
  document.querySelectorAll(`[data-case-prompt="${item.id}"]`).forEach((prompt) => {
    prompt.textContent = getCasePrompt(item);
  });
  const language = state.promptLanguages[item.id] || "original";
  const containers = new Set();
  document.querySelectorAll(`[data-case-prompt="${item.id}"]`).forEach((prompt) => {
    const container = prompt.closest(".case-card") || prompt.closest(".case-detail-card");
    if (container) containers.add(container);
  });
  containers.forEach((container) => {
    container.querySelectorAll(".lang-tab").forEach((button) => {
      updateLanguageButton(button, language, item.id);
    });
  });
}

function updateLanguageButton(button, language, id) {
    const isOriginal = button.textContent.trim() === "原文";
    const isChinese = button.textContent.trim() === "中文" || button.textContent.trim() === "翻译中";
    button.classList.toggle("active", (isOriginal && language === "original") || (isChinese && language === "zh"));
    if (isChinese) {
      button.disabled = Boolean(state.translatingPrompts[id]);
      button.textContent = state.translatingPrompts[id] ? "翻译中" : "中文";
    }
}

window.openLightbox = function openLightbox(src) {
  if ($("#caseDetailDialog")?.open) $("#caseDetailDialog").close();
  $("#lightboxImg").src = src;
  $("#lightbox").showModal();
};

window.openCaseDetail = function openCaseDetail(id) {
  const item = findCase(id);
  if (!item) return;
  renderCaseDetail(item);
  $("#caseDetailDialog").showModal();
};

function renderCaseDetail(item) {
  const image = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" data-case-action="lightbox" data-case-src="${escapeHtml(item.image)}" />`
    : `<div class="detail-image-empty">暂无图片</div>`;
  const language = state.promptLanguages[item.id] || "original";
  const translating = Boolean(state.translatingPrompts[item.id]);
  $("#caseDetailContent").innerHTML = `
    <article class="case-detail-card">
      <button class="case-detail-close" type="button" data-case-action="close-detail" aria-label="关闭">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="case-detail-media">${image}</div>
      <div class="case-detail-body">
        <div class="case-detail-meta">
          <span class="badge badge-cat">${escapeHtml(item.categoryName)}</span>
          <span class="badge badge-num">Case ${item.caseNumber || "-"}</span>
          ${item.sourceFile ? `<span class="badge badge-source">${escapeHtml(item.sourceFile)}</span>` : ""}
        </div>
        <div class="case-detail-title">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="author">${escapeHtml(item.author || "Unknown")}</p>
          </div>
          <div class="prompt-lang-tabs" aria-label="提示词语言切换">
            <button class="lang-tab ${language === "original" ? "active" : ""}" type="button" data-case-action="language" data-case-id="${item.id}" data-case-language="original">原文</button>
            <button class="lang-tab ${language === "zh" ? "active" : ""}" type="button" data-case-action="language" data-case-id="${item.id}" data-case-language="zh" ${translating ? "disabled" : ""}>${translating ? "翻译中" : "中文"}</button>
          </div>
        </div>
        ${item.sourceUrl ? `<a class="case-source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">查看来源</a>` : ""}
        <div class="case-detail-prompt">
          <pre data-case-prompt="${item.id}">${escapeHtml(getCasePrompt(item))}</pre>
        </div>
        <div class="case-detail-actions">
          <button class="btn-primary" type="button" data-case-action="use" data-case-id="${item.id}">带入创作</button>
          <button type="button" data-case-action="copy" data-case-id="${item.id}">复制</button>
          <button type="button" data-case-action="edit" data-case-id="${item.id}">编辑</button>
          <button class="danger" type="button" data-case-action="delete" data-case-id="${item.id}">删除</button>
        </div>
      </div>
    </article>`;
}

window.closeCaseDetail = function closeCaseDetail() {
  $("#caseDetailDialog").close();
};

window.usePrompt = function usePrompt(id) {
  const item = findCase(id);
  if (!item) return;
  state.activeCase = item;
  setStudioPromptValue(getCasePrompt(item));
  if ($("#caseDetailDialog")?.open) $("#caseDetailDialog").close();
  switchView("studio");
  recordCaseUse(item.id, "gallery");
  showNotice(`已带入「${item.title}」的 Prompt`, "success");
};

window.copyPrompt = async function copyPrompt(id) {
  const item = findCase(id);
  if (!item) return;
  await copyText(getCasePrompt(item));
  showNotice("Prompt 已复制到剪贴板", "success");
};

async function recordCaseUse(caseId, source) {
  if (!caseId) return;
  try {
    const result = await api(`/api/cases/${caseId}/use`, {
      method: "POST",
      body: JSON.stringify({
        userId: state.user?.id || null,
        source,
      }),
    });
    syncCaseUseCount(caseId, result.useCount);
  } catch (error) {
    console.warn("案例使用记录失败：", error.message);
  }
}

function syncCaseUseCount(caseId, useCount) {
  const nextCount = Number(useCount);
  if (!Number.isFinite(nextCount)) return;
  const matchesCase = (item) => Number(item.id) === Number(caseId);
  state.cases.forEach((item) => {
    if (matchesCase(item)) item.useCount = nextCount;
  });
  state.caseReferenceCases.forEach((item) => {
    if (matchesCase(item)) item.useCount = nextCount;
  });
  state.caseReferenceGroups.forEach((group) => {
    group.cases.forEach((item) => {
      if (matchesCase(item)) item.useCount = nextCount;
    });
    sortCasesByUsage(group.cases);
  });
}

function sortCasesByUsage(cases) {
  cases.sort((a, b) => (
    Number(b.useCount || 0) - Number(a.useCount || 0) ||
    Number(b.caseNumber || 0) - Number(a.caseNumber || 0) ||
    Number(b.id || 0) - Number(a.id || 0)
  ));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

window.openCaseDialog = function openCaseDialog(id) {
  if ($("#caseDetailDialog")?.open) $("#caseDetailDialog").close();
  const item = findCase(id) || {};
  const form = $("#caseForm");
  form.reset();
  form.elements.id.value = item.id || "";
  form.elements.categoryId.value = item.categoryId || state.bootstrap.categories[0]?.id || "";
  form.elements.caseNumber.value = item.caseNumber || "";
  form.elements.title.value = item.title || "";
  form.elements.author.value = item.author || "";
  form.elements.sourceUrl.value = item.sourceUrl || "";
  form.elements.image.value = item.image || "";
  form.elements.prompt.value = item.prompt || "";
  if (item.id) form.elements.caseNumber.dataset.autoCaseNumber = "false";
  else form.elements.caseNumber.dataset.autoCaseNumber = "true";
  $("#caseFormTitle").textContent = item.id ? "编辑案例" : "新增案例";
  $("#caseDialog").showModal();
  if (!item.id) refreshNextCaseNumber();
};

function bindCaseNumberAutomation() {
  const form = $("#caseForm");
  if (!form) return;
  const categorySelect = form.elements.categoryId;
  const caseNumberInput = form.elements.caseNumber;
  categorySelect.addEventListener("change", () => {
    if (form.elements.id.value) return;
    caseNumberInput.dataset.autoCaseNumber = "true";
    refreshNextCaseNumber();
  });
  caseNumberInput.addEventListener("input", () => {
    if (caseNumberInput.dataset.loadingCaseNumber === "true") return;
    caseNumberInput.dataset.autoCaseNumber = "false";
  });
}

async function refreshNextCaseNumber() {
  const form = $("#caseForm");
  if (!form || form.elements.id.value) return;
  const categoryId = form.elements.categoryId.value;
  const caseNumberInput = form.elements.caseNumber;
  if (!categoryId) return;
  const requestId = ++nextCaseNumberRequest;
  caseNumberInput.dataset.loadingCaseNumber = "true";
  caseNumberInput.placeholder = "正在识别编号...";
  try {
    const params = new URLSearchParams({ categoryId });
    const result = await api(`/api/cases/next-number?${params}`);
    if (requestId !== nextCaseNumberRequest || caseNumberInput.dataset.autoCaseNumber !== "true") return;
    caseNumberInput.value = result.nextCaseNumber || "";
    caseNumberInput.placeholder = "案例编号（自动接续）";
  } catch (error) {
    if (requestId === nextCaseNumberRequest) {
      caseNumberInput.placeholder = "案例编号（数字）";
      showNotice(`编号识别失败：${error.message}`, "error");
    }
  } finally {
    if (requestId === nextCaseNumberRequest) delete caseNumberInput.dataset.loadingCaseNumber;
  }
}

window.removeCase = async function removeCase(id) {
  const ok = await confirmAction("删除后无法恢复，确定要删除这个案例吗？", { title: "删除案例" });
  if (!ok) return;
  await api(`/api/cases/${id}`, { method: "DELETE" });
  await Promise.all([refreshCases(), loadCaseReferences()]);
  showNotice("案例已删除", "success");
};

async function saveCase(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  const id = body.id;
  delete body.id;
  await api(id ? `/api/cases/${id}` : "/api/cases", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body),
  });
  $("#caseDialog").close();
  await Promise.all([refreshCases(), loadCaseReferences()]);
  showNotice("案例已保存", "success");
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
  } catch (error) {
    showNotice(`用户创建失败：${error.message}`, "error");
    return;
  }
  form.reset();
  $("#userCreateDialog").close();
  await refreshBootstrap();
  renderAll();
  showNotice("用户已创建", "success");
}

async function recharge(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  await api(`/api/users/${body.userId}/recharge`, { method: "POST", body: JSON.stringify(body) });
  $("#adminRechargeDialog").close();
  await refreshBootstrap();
  renderAll();
  if (state.user) {
    const fresh = state.bootstrap.users.find((u) => u.id === state.user.id);
    if (fresh) {
      state.user.balanceCents = fresh.balanceCents;
      localStorage.setItem("prompt_user", JSON.stringify(state.user));
      renderUser();
    }
  }
  showNotice("充值完成", "success");
}

async function login(event) {
  event.preventDefault();
  const user = await api("/api/login", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())),
  });
  state.user = user.user;
  localStorage.setItem("prompt_user", JSON.stringify(state.user));
  renderUser();
  $("#userDialog").close();
  state.timeline = [];
  stageState.status = "empty"; stageState.imageUrl = null; stageState.videoUrl = null; stageState.prompt = "";
  renderTimeline();
  await renderHistory();
  showNotice(`欢迎回来，${state.user.name}`, "success");
}

/* ---------- 注册 / 登录弹窗 ---------- */
function showUserDialog() {
  renderUser();
  $("#signedInUser").hidden = false;
  $("#authSection").hidden = true;
  $("#userDialog").showModal();
}

function openAuthDialog(hint = "") {
  $("#signedInUser").hidden = true;
  $("#authSection").hidden = false;
  setAuthTab("login");
  const hintEl = $("#authHint");
  hintEl.textContent = hint;
  hintEl.hidden = !hint;
  $("#userDialog").showModal();
}

function setAuthTab(tab) {
  $("#authTabLogin").classList.toggle("active", tab === "login");
  $("#authTabRegister").classList.toggle("active", tab === "register");
  $("#sidebarLoginForm").hidden = tab !== "login";
  $("#registerForm").hidden = tab !== "register";
}

async function register(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const email = String(data.email || "").trim();
  const phone = String(data.phone || "").trim();
  if (email.length < 3) throwNotice("账号至少 3 个字符");
  if (!/^1[3-9]\d{9}$/.test(phone)) throwNotice("请输入正确的 11 位手机号");
  if (!/^\d{6}$/.test(String(data.smsCode || "").trim())) throwNotice("请输入 6 位短信验证码");
  if (String(data.password || "").length < 6) throwNotice("密码至少 6 位");
  if (data.password !== data.password2) throwNotice("两次输入的密码不一致");

  const result = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ email, password: data.password, phone, smsCode: String(data.smsCode).trim() }),
  });
  state.user = result.user;
  localStorage.setItem("prompt_user", JSON.stringify(state.user));
  event.target.reset();
  renderUser();
  $("#userDialog").close();
  state.timeline = [];
  stageState.status = "empty"; stageState.imageUrl = null; stageState.videoUrl = null; stageState.prompt = "";
  renderTimeline();
  await renderHistory();
  showNotice(`注册成功，欢迎 ${state.user.name}！`, "success");
}

/* 发送短信验证码：60 秒倒计时防重复点击（服务端另有限流） */
let smsCountdownTimer = null;

async function sendSmsCode() {
  const phone = $("#regPhone").value.trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) throwNotice("请先输入正确的 11 位手机号");
  const button = $("#sendSmsButton");
  button.disabled = true;
  try {
    const result = await api("/api/sms/send", { method: "POST", body: JSON.stringify({ phone }) });
    showNotice(result.mock ? "本地联调模式：验证码已打印在服务端终端" : "验证码已发送，请查收短信", "success");
    let remain = 60;
    button.textContent = `${remain}s 后重发`;
    clearInterval(smsCountdownTimer);
    smsCountdownTimer = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        clearInterval(smsCountdownTimer);
        button.disabled = false;
        button.textContent = "获取验证码";
      } else {
        button.textContent = `${remain}s 后重发`;
      }
    }, 1000);
  } catch (error) {
    button.disabled = false;
    throw error;
  }
}

/* ---------- 对话式生成 ---------- */
/* ----- 创作舞台：空场 / 创作中（墨水躁动）/ 作品展示 ----- */
const stageState = {
  status: "empty", // empty | loading | done | failed
  imageUrl: null,
  videoUrl: null,
  prompt: "",
  model: "",
  chargeCents: null,
  error: "",
  transform: { scale: 1, rotate: 0, x: 0, y: 0 },
};

let stageFailureSnapshot = null;

window.dismissStageFailure = function dismissStageFailure() {
  if (stageFailureSnapshot) {
    Object.assign(stageState, stageFailureSnapshot, { error: "" });
    stageFailureSnapshot = null;
  } else {
    stageState.status = "empty";
    stageState.error = "";
  }
  renderStage();
};

function renderTimeline() {
  renderStage();
}

/* 创作等待动画：远景黑色剪影武侠对决（快速过招 + 绝招 + 残影，见 styles.css 的 kf- 系列） */
const KUNGFU_FIG_A = `
    <ellipse class="kf-shadow" cx="50" cy="143" rx="24" ry="4.5"/>
    <circle cx="50" cy="38" r="9"/>
    <path d="M50 47 L54 84" stroke-width="6"/>
    <path d="M51 55 L35 67 L41 80"/>
    <g class="kf-arm-sword">
      <path d="M52 56 L72 61"/>
      <path class="kf-sword" d="M72 61 L104 49"/>
    </g>
    <path d="M54 84 L69 106 L67 130"/>
    <path d="M54 84 L42 110 L33 132"/>`;

const KUNGFU_FIG_B = `
    <ellipse class="kf-shadow" cx="288" cy="143" rx="24" ry="4.5"/>
    <circle cx="290" cy="38" r="9"/>
    <path d="M290 47 L286 84" stroke-width="6"/>
    <g class="kf-arm-punch">
      <path d="M289 56 L268 60"/>
      <path d="M268 60 L252 53"/>
    </g>
    <path d="M289 55 L304 69 L299 82"/>
    <g class="kf-leg-kick">
      <path d="M286 84 L263 94 L242 90"/>
    </g>
    <path d="M286 84 L295 110 L303 132"/>`;

const KUNGFU_SVG = `
<svg class="kungfu-svg" viewBox="0 0 340 150" aria-hidden="true">
  <g class="kf-a kf-ghost">${KUNGFU_FIG_A}</g>
  <g class="kf-a">${KUNGFU_FIG_A}</g>
  <g class="kf-b kf-ghost">${KUNGFU_FIG_B}</g>
  <g class="kf-b">${KUNGFU_FIG_B}</g>
  <circle class="kf-ring" cx="172" cy="62" r="26"/>
  <path class="kf-spark kf-spark1" d="M158 50 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z"/>
  <path class="kf-spark kf-spark2" d="M150 68 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z"/>
  <path class="kf-spark kf-spark3" d="M132 64 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z"/>
  <path class="kf-spark kf-spark4" d="M172 44 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z"/>
</svg>`;

function renderStage() {
  const area = $("#genTimeline");
  const actions = $("#stageActions");

  if (stageState.status === "loading") {
    if (actions) actions.hidden = true;
    area.innerHTML = `
      <div class="gen-stage">
        <div class="stage-loading">
          ${KUNGFU_SVG}
          <div class="stage-status">
            <div class="spinner spinner-sm"></div>
            <span>${state.generationMode === "video" ? "镜头正在生成视频…" : "墨水正在凝聚作品…"}</span>
            <span class="gen-timer" id="gen-timer-stage">0.0 s</span>
          </div>
        </div>
      </div>`;
    return;
  }

  if (stageState.status === "done") {
    const mediaUrl = stageState.videoUrl || stageState.imageUrl;
    const media = stageState.videoUrl
      ? `<video id="stageVideo" class="stage-video" src="${escapeHtml(mediaUrl)}" controls playsinline></video>`
      : `<img id="stageImg" class="stage-img" src="${escapeHtml(mediaUrl)}" alt="生成作品" draggable="false" />`;
    area.innerHTML = `
      <div class="gen-stage">
        <div class="stage-artwrap" id="stageArtwrap">
          ${media}
        </div>
      </div>`;
    if (actions) actions.hidden = false;
    applyStageTransform();
    if (!stageState.videoUrl) bindStageImageEvents();
    const inpaintButton = $("#stageInpaint");
    if (inpaintButton) inpaintButton.hidden = Boolean(stageState.videoUrl);
    return;
  }

  if (stageState.status === "failed") {
    if (actions) actions.hidden = true;
    area.innerHTML = `
      <div class="gen-stage">
        <div class="stage-fail">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
          <strong>生成失败</strong>
          <p class="stage-fail-msg">${escapeHtml(stageState.error || "未知错误")}</p>
          <div class="row-actions" style="justify-content:center">
            <button class="btn-primary small-button" type="button" onclick="generate()" style="min-height:34px">重试</button>
            <button class="small-button" type="button" onclick="dismissStageFailure()" style="min-height:34px">返回</button>
          </div>
        </div>
      </div>`;
    return;
  }

  if (actions) actions.hidden = true;
  area.innerHTML = `
    <div class="gen-empty" id="genEmpty">
      <div class="gen-empty-inner">
        <div class="empty-visual">
          <div class="empty-orb">
            <img class="empty-fairy-logo" src="images/logo.svg" alt="AI 照相馆小仙女" />
          </div>
        </div>
        <strong>${state.user ? "准备开始创作" : "请先登录后开始创作"}</strong>
        <p>输入提示词并发送，墨水将为你揭幕作品；过往创作请到「历史」页查看</p>
        <div class="stage-privacy-hint">
          <span>上传自己或者他人肖像的</span>
          <span>请注意隐私保护</span>
          <span>勾选下方「已获人物授权」</span>
        </div>
      </div>
    </div>`;
}

function applyStageTransform() {
  const img = $("#stageImg");
  if (!img) return;
  const t = stageState.transform;
  img.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotate}deg)`;
}

function stageZoom(delta) {
  stageState.transform.scale = Math.min(6, Math.max(0.2, stageState.transform.scale + delta));
  applyStageTransform();
}

function stageRotate() {
  stageState.transform.rotate = (stageState.transform.rotate + 90) % 360;
  applyStageTransform();
}

function resetStageTransform() {
  stageState.transform = { scale: 1, rotate: 0, x: 0, y: 0 };
  applyStageTransform();
}

function clearStage() {
  stageState.status = "empty";
  stageState.imageUrl = null;
  stageState.videoUrl = null;
  stageState.prompt = "";
  resetStageTransform();
  renderStage();
  state.fluidSim?.setExcitement(0);
  showNotice("工作区已恢复", "info");
}

function stageReusePrompt() {
  if (!stageState.prompt) return;
  setStudioPromptValue(stripAuthStatement(stageState.prompt));
  syncAuthorizationStatement();
  $("#studioPrompt").focus();
  showNotice("Prompt 已带回输入框", "success");
}

function stageDownload() {
  const mediaUrl = stageState.videoUrl || stageState.imageUrl;
  if (!mediaUrl) return;
  const anchor = document.createElement("a");
  anchor.href = mediaUrl;
  anchor.download = stageState.videoUrl ? `ai-photo-video-${Date.now()}.mp4` : `ai-photo-${Date.now()}.png`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** 局部修改：把当前作品取回作为底图，切到局部重绘模式 */
async function stageInpaint() {
  if (!stageState.imageUrl || stageState.videoUrl) return;
  try {
    const response = await fetch(stageState.imageUrl);
    const blob = await response.blob();
    const file = new File([blob], "artwork.png", { type: blob.type || "image/png" });
    state.referenceFiles = [file];
    renderReferencePreview();
    setGenerationMode("inpaint");
    showNotice("已载入当前作品，请在底图上涂抹需要修改的区域", "success");
    $("#studioPrompt").focus();
  } catch {
    throwNotice("作品载入失败，请重试");
  }
}

/* 舞台图片交互：滚轮缩放 / 拖拽平移 / 双击复位 */
function bindStageImageEvents() {
  const wrap = $("#stageArtwrap");
  const img = $("#stageImg");
  if (!wrap || !img) return;

  wrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    stageZoom(event.deltaY > 0 ? -0.12 : 0.12);
  }, { passive: false });

  img.addEventListener("dblclick", resetStageTransform);

  let dragging = null;
  img.addEventListener("pointerdown", (event) => {
    dragging = { startX: event.clientX, startY: event.clientY, baseX: stageState.transform.x, baseY: stageState.transform.y };
    img.setPointerCapture(event.pointerId);
  });
  img.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    stageState.transform.x = dragging.baseX + (event.clientX - dragging.startX);
    stageState.transform.y = dragging.baseY + (event.clientY - dragging.startY);
    applyStageTransform();
  });
  img.addEventListener("pointerup", () => { dragging = null; });
  img.addEventListener("pointercancel", () => { dragging = null; });
}

/* ----- 全页墨水流体 + 九色墨水选择器 ----- */
const INK_CHOICES = [
  { key: "#8b5cf6", label: "紫罗兰" },
  { key: "#ec4899", label: "玫红" },
  { key: "#ef4444", label: "绯红" },
  { key: "#f59e0b", label: "琥珀" },
  { key: "#22c55e", label: "翠绿" },
  { key: "#06b6d4", label: "青碧" },
  { key: "#3b82f6", label: "海蓝" },
  { key: "#e2e8f0", label: "银白" },
  { key: "rainbow", label: "随机彩" },
];

let inkPaletteTimer = null;
const INK_TOP_ZONE = 140; // 鼠标进入页面顶部该范围内时浮现色板

function initGlobalFluid() {
  const canvas = $("#fluidCanvas");
  if (canvas && typeof window.createFluidSim === "function") {
    state.fluidSim = window.createFluidSim(canvas, document.body);
  }
  buildInkPalette();
  applyInkColor(localStorage.getItem("ink_color") || "#8b5cf6", false);

  // 鼠标到达画布顶部 → 色板逐个淡入；移开顶部 → 逐个淡出
  document.addEventListener("pointermove", (event) => {
    if (state.view !== "studio" || !state.fluidSim) return;
    const host = $("#inkPalette");
    const overPalette = host && host.contains(event.target);
    if (event.clientY <= INK_TOP_ZONE || overPalette) showInkPalette();
    else hideInkPalette();
  }, { passive: true });
}

function buildInkPalette() {
  const host = $("#inkPalette");
  if (!host) return;
  host.innerHTML = INK_CHOICES.map(
    (c, i) => `
    <button type="button" class="ink-swatch ${c.key === "rainbow" ? "rainbow" : ""}" data-ink="${c.key}"
      title="${c.label}" style="${c.key !== "rainbow" ? `background:${c.key};` : ""}--swatch-delay:${i * 55}ms"></button>`
  ).join("");
  host.querySelectorAll(".ink-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => applyInkColor(swatch.dataset.ink, true));
  });
}

function showInkPalette() {
  clearTimeout(inkPaletteTimer);
  inkPaletteTimer = null;
  $("#inkPalette")?.classList.add("visible");
}

function hideInkPalette() {
  if (inkPaletteTimer) return;
  inkPaletteTimer = setTimeout(() => {
    inkPaletteTimer = null;
    $("#inkPalette")?.classList.remove("visible");
  }, 240);
}

function applyInkColor(key, notify) {
  document.querySelectorAll("#inkPalette .ink-swatch").forEach((s) =>
    s.classList.toggle("selected", s.dataset.ink === key)
  );
  localStorage.setItem("ink_color", key);
  if (!state.fluidSim) return;
  state.fluidSim.setInk(key === "rainbow" ? "rainbow" : makeInkVariants(key));
  if (notify) {
    const choice = INK_CHOICES.find((c) => c.key === key);
    showNotice(`墨水已切换为「${choice?.label || key}」`, "success");
  }
}

/* 由主色生成 5 个邻近色相/明度的墨水变体，让融合更有层次 */
function makeInkVariants(hex) {
  const [h, s, l] = rgbToHsl(...hexToRgb01(hex));
  return [
    [0, 0, 0],
    [-0.035, 0.05, 0.07],
    [0.03, -0.08, -0.05],
    [0.06, 0, 0.12],
    [-0.06, 0.04, -0.08],
  ].map(([dh, ds, dl]) => hslToRgb((h + dh + 1) % 1, clamp01(s + ds), clamp01(l + dl)));
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

function renderGenRecord(record) {
  const head = `
    <div class="gen-record-head">
      <span class="model-name">${escapeHtml(record.model || "")}</span>
      ${record.status === "succeeded" ? `<span class="badge badge-success">成功</span>` : ""}
      ${record.status === "failed" ? `<span class="badge badge-failed">失败</span>` : ""}
      ${record.status === "loading" ? `<span class="badge badge-cat">生成中</span>` : ""}
      <span class="spacer"></span>
      <span class="meta">${record.chargeCents != null ? `${money(record.chargeCents)} · ` : ""}${record.createdAt ? formatTime(record.createdAt) : ""}</span>
    </div>`;

  const promptHtml = record.prompt
    ? `<p class="gen-prompt" onclick="this.classList.toggle('expanded')" title="点击展开/收起">${escapeHtml(stripAuthStatement(record.prompt))}</p>`
    : "";

  if (record.status === "loading") {
    return `
      <div class="gen-record gen-loading-card" data-key="${record.key}">
        ${head}
        ${promptHtml}
        <div class="gen-loading-row">
          <div class="spinner"></div>
          <div>
            <div class="gen-status">正在生成，请稍候…</div>
            <div class="gen-timer" id="gen-timer-${record.key}">0.0 s</div>
          </div>
        </div>
        <div class="sk gen-shimmer"></div>
      </div>`;
  }

  if (record.status === "failed") {
    return `
      <div class="gen-record" data-key="${record.key}">
        ${head}
        ${promptHtml}
        <div class="gen-error">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
          <span>${escapeHtml(record.errorMessage || "生成失败")}</span>
        </div>
        <div class="gen-record-actions">
          <button class="small-button" type="button" onclick="reusePrompt('${record.key}')">复用 Prompt</button>
        </div>
      </div>`;
  }

  return `
    <div class="gen-record" data-key="${record.key}">
      ${head}
      ${promptHtml}
      ${record.imageUrl ? `
        <div class="gen-image-wrap">
          <img src="${escapeHtml(record.imageUrl)}" alt="生成结果" loading="lazy" onclick="openLightbox('${escapeHtml(record.imageUrl)}')" />
        </div>` : ""}
      <div class="gen-record-actions">
        ${record.imageUrl ? `
          <a class="small-button" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:0 11px;min-height:29px;background:var(--glass-bg);color:var(--text-primary);font-size:13px" href="${escapeHtml(record.imageUrl)}" download target="_blank" rel="noopener">下载原图</a>
          <button class="small-button" type="button" onclick="openLightbox('${escapeHtml(record.imageUrl)}')">查看大图</button>` : ""}
        <button class="small-button" type="button" onclick="reusePrompt('${record.key}')">复用 Prompt</button>
      </div>
    </div>`;
}

window.reusePrompt = function reusePrompt(key) {
  const record = state.timeline.find((item) => String(item.key) === String(key));
  if (!record) return;
  setStudioPromptValue(stripAuthStatement(record.prompt || ""));
  $("#studioPrompt").focus();
  showNotice("Prompt 已带入输入框", "success");
};

function stripAuthStatement(prompt) {
  return String(prompt || "").replace(AUTHORIZATION_STATEMENT, "").trim();
}

function scrollTimelineToEnd(behavior = "smooth") {
  requestAnimationFrame(() => {
    const main = $(".main");
    if (main) {
      main.scrollTo({ top: main.scrollHeight, behavior });
    }
  });
}

async function generate() {
  if (state.generating) return;
  if (!state.user) {
    openAuthDialog("登录后即可开始生成；新用户注册仅需账号和密码");
    return;
  }
  const prompt = withAuthorizationStatement($("#studioPrompt").value.trim(), $("#authorizationConfirmed").checked);
  const modelDisplayName = $("#studioPrice").value;
  const referenceFile = state.referenceFiles[0];
  if (!prompt) throwNotice("Prompt 不能为空");
  if (isVideoGenerationMode(state.generationMode)) {
    if (state.generationMode === "imageVideo" && !state.referenceFiles.length) throwNotice("图生视频需要先上传参考图");
    if (state.generationMode === "videoVideo" && !state.referenceVideos.length) throwNotice("视频生视频需要先上传参考视频");
    await performVideoGenerate();
    return;
  }
  if (!modelDisplayName) throwNotice("请先在「供应商」页配置并启用生图模型");
  if (state.generationMode === "image" && !referenceFile) {
    throwNotice("文+图生图需要先上传参考图");
  }
  if (state.generationMode === "inpaint") {
    if (!referenceFile) throwNotice("局部重绘需要先上传原图");
    if (!maskState.strokes.length) throwNotice("请先涂抹需要重绘的区域");
  }

  // 余额不足 → 单次扫码付费，支付成功后自动生成
  const price = generationPrices().find((p) => p.displayName === modelDisplayName);
  const priceCents = Number(price?.unitPriceCents || 0);
  if (priceCents > 0 && Number(state.user.balanceCents) < priceCents) {
    await startPayPerGeneration({ priceCents, modelDisplayName });
    return;
  }

  await performGenerate();
}

async function performGenerate(payOrderNo = null) {
  if (state.generating) return;
  const prompt = withAuthorizationStatement($("#studioPrompt").value.trim(), $("#authorizationConfirmed").checked);
  const modelDisplayName = $("#studioPrice").value;
  const referenceFiles = state.referenceFiles;

  const button = $("#generateButton");
  button.disabled = true;
  state.generating = true;
  resetPromptInputHeight();

  // 进入创作态：墨水开始躁动
  const previousStage = { ...stageState, transform: { ...stageState.transform } };
  stageState.status = "loading";
  renderStage();
  state.fluidSim?.setExcitement(1);

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const el = $("#gen-timer-stage");
    if (el) el.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)} s`;
  }, 100);

  try {
    const formData = new FormData();
    formData.append("userId", state.user.id);
    formData.append("modelDisplayName", modelDisplayName);
    formData.append("generationMode", state.generationMode);
    formData.append("prompt", prompt);
    formData.append("authorizationConfirmed", $("#authorizationConfirmed").checked ? "true" : "false");
    if (state.activeCase?.id) formData.append("caseId", state.activeCase.id);
    if (payOrderNo) formData.append("payOrderNo", payOrderNo);
    if (referenceFiles.length && state.generationMode !== "text") {
      // 局部重绘只传第一张原图；文+图模式支持多张参考图
      const filesToSend = state.generationMode === "inpaint" ? referenceFiles.slice(0, 1) : referenceFiles;
      for (const file of filesToSend) formData.append("referenceImage", file);
    }
    if (state.generationMode === "inpaint") {
      formData.append("maskImage", await createMaskBlob(), "mask.png");
    }
    const result = await api("/api/generate", { method: "POST", body: formData, headers: {} });
    state.user.balanceCents = result.balanceCents;
    localStorage.setItem("prompt_user", JSON.stringify(state.user));

    // 揭幕：墨水散开，作品在中央淡入
    state.fluidSim?.setExcitement(0);
    state.fluidSim?.disperse?.();
    setTimeout(() => {
      stageState.status = "done";
      stageState.imageUrl = result.imageUrl;
      stageState.videoUrl = null;
      stageState.prompt = prompt;
      stageState.model = modelDisplayName;
      stageState.chargeCents = result.chargeCents;
      resetStageTransform();
      renderStage();
    }, 380);

    renderUser();
    renderHistory();
    showNotice(payOrderNo ? "支付成功，作品已揭幕" : `生成成功，扣费 ${money(result.chargeCents)}`, "success");
  } catch (error) {
    // 失败：墨水平息，失败原因常驻舞台（可重试 / 返回）
    state.fluidSim?.setExcitement(0);
    stageFailureSnapshot = previousStage;
    stageState.status = "failed";
    stageState.error = error.message + (payOrderNo ? "（本次支付未核销，重试无需再次付费）" : "");
    renderStage();
    renderHistory();
    showNotice(`生成失败：${error.message}`, "error");
  } finally {
    clearInterval(timer);
    button.disabled = false;
    state.generating = false;
  }
}

async function performVideoGenerate() {
  if (state.generating) return;
  const prompt = withAuthorizationStatement($("#studioPrompt").value.trim(), $("#authorizationConfirmed").checked);
  const referenceFiles = state.referenceFiles.slice(0, 3);
  const referenceImages = state.generationMode === "videoVideo" ? [] : referenceFiles;
  const referenceVideos = state.generationMode === "videoVideo" ? state.referenceVideos.slice(0, 1) : [];

  const button = $("#generateButton");
  button.disabled = true;
  state.generating = true;
  resetPromptInputHeight();

  const previousStage = { ...stageState, transform: { ...stageState.transform } };
  stageState.status = "loading";
  stageState.imageUrl = null;
  stageState.videoUrl = null;
  renderStage();
  state.fluidSim?.setExcitement(1);

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const el = $("#gen-timer-stage");
    if (el) el.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)} s`;
  }, 100);

  try {
    const formData = new FormData();
    formData.append("userId", state.user.id);
    formData.append("prompt", prompt);
    formData.append("videoMode", state.generationMode);
    formData.append("authorizationConfirmed", $("#authorizationConfirmed").checked ? "true" : "false");
    formData.append("videoRatio", $("#videoRatio")?.value || "9:16");
    formData.append("videoDuration", $("#videoDuration")?.value || "5");
    formData.append("videoResolution", $("#videoResolution")?.value || "720p");
    for (const file of referenceImages) formData.append("referenceImage", file);
    for (const file of referenceVideos) formData.append("referenceVideo", file);

    const task = await api("/api/video/generate", { method: "POST", body: formData, headers: {} });
    const result = await pollVideoTask(task);
    if (result.status !== "succeeded" || !result.videoUrl) {
      throw new Error(result.errorMessage || "视频生成未完成，请稍后到历史记录查看");
    }

    state.user.balanceCents = result.balanceCents ?? Math.max(0, Number(state.user.balanceCents || 0) - Number(result.chargeCents || 0));
    localStorage.setItem("prompt_user", JSON.stringify(state.user));

    state.fluidSim?.setExcitement(0);
    state.fluidSim?.disperse?.();
    stageState.status = "done";
    stageState.imageUrl = null;
    stageState.videoUrl = result.videoUrl;
    stageState.prompt = prompt;
    stageState.model = result.model || "Seedance 视频";
    stageState.chargeCents = result.chargeCents;
    resetStageTransform();
    renderStage();

    renderUser();
    await renderHistory();
    showNotice(`视频生成成功，扣费 ${money(result.chargeCents || 0)}`, "success");
  } catch (error) {
    state.fluidSim?.setExcitement(0);
    stageFailureSnapshot = previousStage;
    stageState.status = "failed";
    stageState.error = error.message;
    renderStage();
    await renderHistory();
    showNotice(`视频生成失败：${error.message}`, "error");
  } finally {
    clearInterval(timer);
    button.disabled = false;
    state.generating = false;
  }
}

async function pollVideoTask(task) {
  const pollMs = Math.max(1200, Number(task.pollMs || 5000));
  for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(pollMs);
    const result = await api(`/api/video/tasks/${task.id}?userId=${encodeURIComponent(state.user.id)}`);
    if (["succeeded", "failed"].includes(result.status)) return result;
  }
  throw new Error("视频生成仍在处理中，请稍后刷新历史记录查看");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- 供应商页面：模型列表 ---------- */
function renderSettings() {
  const list = $("#providersList");
  const rows = providerModelRows();
  if (!rows.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg>
        <strong>还没有上架模型</strong>
        <p>点击「新建供应商」接入供应商并添加模型价格</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <div class="provider-model-table-wrap">
      <table class="provider-model-table">
        <thead>
          <tr>
            <th>供应商</th>
            <th>展示名称</th>
            <th>模型</th>
            <th>单价</th>
            <th>启用开关</th>
            <th>编辑</th>
            <th>删除</th>
          </tr>
        </thead>
        <tbody>${rows.map(renderProviderModelRow).join("")}</tbody>
      </table>
    </div>`;
}

function providerModelRows() {
  const providersById = new Map(state.bootstrap.providers.map((provider) => [Number(provider.id), provider]));
  return state.bootstrap.prices.map((price) => ({
    ...price,
    provider: providersById.get(Number(price.providerId)),
  }));
}

function renderProviderModelRow(price) {
  const provider = price.provider || {};
  const providerEnabled = isEnabledFlag(provider.enabled);
  const priceEnabled = isEnabledFlag(price.enabled);
  const rowEnabled = providerEnabled && priceEnabled;
  const rowClass = rowEnabled ? "" : "provider-model-row-muted";
  return `
    <tr class="${rowClass}">
      <td class="provider-model-supplier">${escapeHtml(provider.name || "未知供应商")}</td>
      <td>${escapeHtml(price.displayName)}</td>
      <td class="model-id">${escapeHtml(price.model)}</td>
      <td class="num price-cell">${money(price.unitPriceCents)}<span>/次</span></td>
      <td>
        <input class="table-check" type="checkbox" ${rowEnabled ? "checked" : ""} onchange="toggleProviderModel(${price.id}, ${price.providerId}, this.checked)" aria-label="启用 ${escapeHtml(price.displayName)}" />
      </td>
      <td>
        <button class="small-button icon-text-button" onclick="editProvider(${price.providerId})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          编辑
        </button>
      </td>
      <td>
        <button class="danger small-button icon-text-button" onclick="removePrice(${price.id})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除
        </button>
      </td>
    </tr>`;
}

window.editProvider = function editProvider(id) {
  openProviderWizard(id);
};

/* ---------- 供应商向导 ---------- */
function openProviderWizard(providerId = null) {
  const provider = providerId ? state.bootstrap.providers.find((p) => p.id === providerId) : null;
  state.wizard = {
    providerId: provider?.id || null,
    models: [],
    busy: false,
    originalName: provider?.name || "",
    originalBaseUrl: provider?.baseUrl || "",
  };
  $("#wizardTitle").textContent = provider ? `编辑供应商「${provider.name}」` : "新建供应商";
  $("#wzName").value = provider?.name || "";
  $("#wzBaseUrl").value = provider?.baseUrl || "";
  $("#wzApiKey").value = "";
  $("#wzApiKey").placeholder = provider ? "留空 = 沿用原 Key" : "sk-…";
  $("#wzKeyHint").hidden = !provider;
  setWizardStep(1);
  $("#providerWizard").showModal();
}

function setWizardStep(step) {
  $("#wizardStep1").hidden = step !== 1;
  $("#wizardStep2").hidden = step !== 2;
  $("#wstepTab1").classList.toggle("active", step === 1);
  $("#wstepTab2").classList.toggle("active", step === 2);
}

async function wizardNext() {
  const name = $("#wzName").value.trim();
  const baseUrl = $("#wzBaseUrl").value.trim();
  const apiKey = $("#wzApiKey").value.trim();
  const editing = Boolean(state.wizard.providerId);
  if (!name) throwNotice("请填写供应商名称");
  if (!baseUrl) throwNotice("请填写 Base URL");
  if (!/^https?:\/\//i.test(baseUrl)) throwNotice("Base URL 需以 http(s):// 开头");
  if (!editing && !apiKey) throwNotice("请填写 API Key");

  const existingPrices = editing
    ? state.bootstrap.prices.filter((p) => p.providerId === state.wizard.providerId)
    : [];

  const button = $("#wizardNextButton");
  button.disabled = true;
  const originalText = button.textContent;

  try {
    let discovered = [];
    if (apiKey) {
      button.textContent = "正在解析模型…";
      const result = await api("/api/providers/discover", {
        method: "POST",
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      discovered = result.models || [];
      if (!discovered.length && !existingPrices.length) {
        throwNotice("接口未返回可用的生图模型，请检查 Base URL 和 Key");
      }
    } else if (editing && !existingPrices.length) {
      throwNotice("该供应商还没有模型，请填写 API Key 进行解析");
    }

    // 合并：已有定价（可编辑）+ 新解析出的模型
    const rows = new Map();
    for (const price of existingPrices) {
      rows.set(price.model, {
        model: price.model,
        displayName: price.displayName,
        priceYuan: (Number(price.unitPriceCents || 0) / 100).toFixed(2),
        source: "existing",
        checked: true,
        existingPriceId: price.id,
      });
    }
    for (const item of discovered) {
      const found = rows.get(item.id);
      const parsedYuan = Number(item.unitPriceCents || 0) / 100;
      if (found) {
        found.source = "both";
        continue;
      }
      rows.set(item.id, {
        model: item.id,
        displayName: item.displayName || item.id,
        priceYuan: item.priceSource === "not_found" || !parsedYuan ? "" : parsedYuan.toFixed(2),
        source: item.priceSource === "not_found" || !parsedYuan ? "manual" : "parsed",
        checked: rows.size === 0,
        existingPriceId: null,
      });
    }

    state.wizard.models = [...rows.values()];
    state.wizard.pendingProvider = { name, baseUrl, apiKey };
    renderWizardModels();
    setWizardStep(2);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderWizardModels() {
  const rows = state.wizard.models;
  $("#wizardModels").innerHTML = rows.length
    ? rows
        .map(
          (row, index) => `
      <div class="wmodel-row ${row.checked ? "" : "wmodel-off"}" data-windex="${index}">
        <input class="table-check" type="checkbox" ${row.checked ? "checked" : ""}
          onchange="wizardToggleModel(${index}, this.checked)" aria-label="上架该模型" />
        <div class="wmodel-info">
          <input class="wmodel-name" value="${escapeHtml(row.displayName)}" placeholder="展示名称"
            oninput="wizardEditModel(${index}, 'displayName', this.value)" />
          <span class="model-id">${escapeHtml(row.model)}</span>
        </div>
        <span class="wmodel-tag ${row.source === "manual" ? "tag-manual" : ""}">${
          row.source === "existing" ? "已上架" : row.source === "both" ? "已上架 · 解析到" : row.source === "parsed" ? "已解析价格" : "需手动定价"
        }</span>
        <div class="wmodel-price ${row.source === "manual" && !row.priceYuan ? "price-missing" : ""}">
          <span>¥</span>
          <input type="number" step="0.01" min="0" value="${escapeHtml(row.priceYuan)}" placeholder="0.00"
            oninput="wizardEditModel(${index}, 'priceYuan', this.value)" />
          <span class="per">/次</span>
        </div>
      </div>`
        )
        .join("")
    : `<p class="panel-sub">没有可配置的模型</p>`;
}

window.wizardToggleModel = function wizardToggleModel(index, checked) {
  const row = state.wizard.models[index];
  if (!row) return;
  row.checked = checked;
  document.querySelector(`[data-windex="${index}"]`)?.classList.toggle("wmodel-off", !checked);
};

window.wizardEditModel = function wizardEditModel(index, field, value) {
  const row = state.wizard.models[index];
  if (!row) return;
  row[field] = value;
  if (field === "priceYuan") {
    const wrap = document.querySelector(`[data-windex="${index}"] .wmodel-price`);
    if (wrap) wrap.classList.toggle("price-missing", row.source === "manual" && !String(value).trim());
  }
};

async function wizardSave() {
  const { pendingProvider, providerId, models } = state.wizard;
  const selected = models.filter((m) => m.checked);
  if (!selected.length) throwNotice("请至少勾选一个要上架的模型");
  for (const row of selected) {
    const price = Number(row.priceYuan);
    if (String(row.priceYuan).trim() === "" || !Number.isFinite(price) || price < 0) {
      throwNotice(`请为「${row.model}」填写有效的单次价格`);
    }
    if (!String(row.displayName).trim()) {
      throwNotice(`请为「${row.model}」填写展示名称`);
    }
  }

  const button = $("#wizardSaveButton");
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "保存中…";

  try {
    const editing = Boolean(state.wizard.providerId);
    const infoUnchanged =
      editing &&
      !pendingProvider.apiKey &&
      pendingProvider.name === state.wizard.originalName &&
      pendingProvider.baseUrl === state.wizard.originalBaseUrl;

    let pid = providerId;
    if (!infoUnchanged) {
      // 新建，或编辑时改了名称 / URL / Key，才需要更新供应商本身
      const providerPayload = {
        ...(providerId ? { id: providerId } : {}),
        name: pendingProvider.name,
        baseUrl: pendingProvider.baseUrl,
        apiKey: pendingProvider.apiKey,
        defaultModel: selected[0].model,
        enabled: true,
      };
      try {
        const saved = await api("/api/providers", { method: "POST", body: JSON.stringify(providerPayload) });
        pid = saved.id;
      } catch (error) {
        if (editing && !pendingProvider.apiKey && /API Key/.test(error.message)) {
          throwNotice("服务端还在运行旧版本：请重启服务（Ctrl+C 后重新 npm run dev），或在上一步填入 API Key 后再保存");
        }
        throw error;
      }
    }

    for (const row of selected) {
      await api("/api/prices", {
        method: "POST",
        body: JSON.stringify({
          providerId: pid,
          model: row.model,
          displayName: String(row.displayName).trim(),
          unitPriceYuan: String(Number(row.priceYuan)),
          enabled: true,
        }),
      });
    }
    // 编辑模式下，取消勾选的已上架模型 → 下架删除
    for (const row of models) {
      if (!row.checked && row.existingPriceId) {
        await api(`/api/prices/${row.existingPriceId}`, { method: "DELETE" });
      }
    }

    $("#providerWizard").close();
    await refreshBootstrap();
    renderAll();
    showNotice(`供应商「${pendingProvider.name}」已保存，上架 ${selected.length} 个模型`, "success");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}


function renderUsers() {
  const users = state.bootstrap.users;
  $("#usersTable").innerHTML = users.length
    ? `<table>
        <thead><tr><th>姓名</th><th>账号</th><th>手机号</th><th>角色</th><th>余额</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${users
          .map(
            (u) => `
          <tr>
            <td>
              <span style="display:inline-flex;align-items:center;gap:9px">
                <span class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml(String(u.name || "?").slice(0, 1))}</span>
                ${escapeHtml(u.name)}
              </span>
            </td>
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.phone || "未填写")}</td>
            <td><span class="badge ${u.role === "admin" ? "badge-cat" : "badge-num"}">${u.role === "admin" ? "管理员" : "用户"}</span></td>
            <td class="num">${money(u.balanceCents)}</td>
            <td style="text-align:right">
              <button class="small-button" onclick="openAdminRecharge(${u.id})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                充值
              </button>
            </td>
          </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state" style="padding:36px 16px"><strong>暂无用户</strong><p>点击右上角「新增用户」创建第一个账号</p></div>`;
}

window.openAdminRecharge = function openAdminRecharge(id) {
  const user = state.bootstrap.users.find((u) => u.id === id);
  if (!user) return;
  $("#rechargeForm").reset();
  $("#rechargeUserId").value = user.id;
  $("#rechargeTargetLabel").textContent = `为「${user.name} · ${user.email}」充值，当前余额 ${money(user.balanceCents)}`;
  $("#adminRechargeDialog").showModal();
};

async function renderHistory() {
  if (!state.user) {
    const hint = `
      <div class="empty-state" style="padding:36px 16px">
        <strong>请先登录</strong>
        <p>登录后即可查看账单与创作历史</p>
      </div>`;
    $("#walletList").innerHTML = hint;
    $("#creationList").innerHTML = hint;
    $("#creationFilter").innerHTML = "";
    if ($("#creationHistoryControls")) $("#creationHistoryControls").hidden = true;
    $("#creationSummary").textContent = "";
    $("#histBalance").textContent = "¥0.00";
    $("#histRechargeSum").textContent = "+¥0.00";
    $("#histConsumeSum").textContent = "−¥0.00";
    renderHistGranularityChips();
    return;
  }
  renderCreationHistoryControls();
  const walletParams = new URLSearchParams();
  if (state.histFilter.from) walletParams.set("from", state.histFilter.from);
  if (state.histFilter.to) walletParams.set("to", state.histFilter.to);
  const creationParams = new URLSearchParams();
  if (state.creationQuery.userId) creationParams.set("userId", state.creationQuery.userId);
  if (state.creationQuery.from) creationParams.set("from", state.creationQuery.from);
  if (state.creationQuery.to) creationParams.set("to", state.creationQuery.to);
  const [wallet, creations] = await Promise.all([
    api(`/api/users/${state.user.id}/wallet?${walletParams}`),
    api(`/api/users/${state.user.id}/creations?${creationParams}`),
  ]);
  state.creationsCache = creations;

  /* ----- 账单页 ----- */
  const rechargeSum = wallet.filter((w) => w.type === "recharge" || w.type === "refund").reduce((s, w) => s + Math.abs(Number(w.amountCents)), 0);
  const consumeSum = wallet.filter((w) => w.type === "consume").reduce((s, w) => s + Math.abs(Number(w.amountCents)), 0);
  $("#histBalance").textContent = money(state.user.balanceCents);
  $("#histRechargeSum").textContent = `+${money(rechargeSum)}`;
  $("#histConsumeSum").textContent = `−${money(consumeSum)}`;
  renderHistGranularityChips();

  $("#walletList").innerHTML = wallet.length
    ? groupWalletEntries(wallet, state.histFilter.granularity)
        .map((group, index) => renderWalletGroup(group, index === 0))
        .join("")
    : `<div class="empty-state" style="padding:36px 16px"><strong>该区间暂无流水</strong><p>调整日期范围，或充值 / 生成图片后这里会出现记录</p></div>`;

  /* ----- 历史页：作品画廊 ----- */
  renderCreationGallery();
}

function renderCreationHistoryControls() {
  const controls = $("#creationHistoryControls");
  if (!controls) return;
  controls.hidden = false;

  const isAdmin = state.user?.role === "admin";
  const userWrap = $("#creationUserFilterWrap");
  const userFilter = $("#creationUserFilter");
  if (userWrap) userWrap.hidden = !isAdmin;
  if (userFilter) {
    const users = state.bootstrap.users || [];
    const validIds = new Set(users.map((user) => String(user.id)));
    if (state.creationQuery.userId !== "all" && !validIds.has(String(state.creationQuery.userId))) {
      state.creationQuery.userId = "all";
    }
    userFilter.innerHTML = [
      `<option value="all">全部用户</option>`,
      ...users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(userFilterLabel(user))}</option>`),
    ].join("");
    userFilter.value = isAdmin ? state.creationQuery.userId : "all";
  }
  if ($("#creationFrom")) $("#creationFrom").value = state.creationQuery.from || "";
  if ($("#creationTo")) $("#creationTo").value = state.creationQuery.to || "";
}

function userFilterLabel(user) {
  const name = user.name || user.email || `用户 ${user.id || ""}`.trim();
  const phone = user.phone ? ` · ${user.phone}` : "";
  return `${name}${phone}`;
}

function isVideoCreation(item) {
  const url = String(item?.imageUrl || "");
  const model = String(item?.model || "").toLowerCase();
  return /\.mp4(?:$|\?)/i.test(url) || model.includes("seedance") || model.includes("video");
}

function renderCreationGallery() {
  const creations = state.creationsCache || [];
  const okCount = creations.filter((c) => c.status === "succeeded").length;
  const failCount = creations.length - okCount;
  const showUser = state.user?.role === "admin";

  // 筛选胶囊
  const filters = [
    { key: "all", label: `全部 ${creations.length}` },
    { key: "succeeded", label: `成功 ${okCount}` },
    { key: "failed", label: `失败 ${failCount}` },
  ];
  $("#creationFilter").innerHTML = filters
    .map((f) => `<button type="button" class="chip ${state.creationFilter === f.key ? "active" : ""}" data-filter="${f.key}">${f.label}</button>`)
    .join("");
  document.querySelectorAll("#creationFilter .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.creationFilter = chip.dataset.filter;
      renderCreationGallery();
    });
  });

  const list = state.creationFilter === "all"
    ? creations
    : creations.filter((c) => c.status === state.creationFilter);
  $("#creationSummary").textContent = creations.length
    ? `共 ${creations.length} 次创作 · 成功 ${okCount} · 失败 ${failCount}`
    : "";

  if (!list.length) {
    $("#creationList").innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
        <strong>${creations.length ? "该筛选下暂无记录" : "暂无创作记录"}</strong>
        <p>${creations.length ? "切换上方筛选试试" : "去「生成」页创作第一张作品吧"}</p>
      </div>`;
    return;
  }

  $("#creationList").innerHTML = list
    .map((item) => {
      const index = state.creationsCache.indexOf(item);
      const ok = item.status === "succeeded";
      const video = isVideoCreation(item);
      const media = item.imageUrl
        ? video
          ? `<div class="artwork-media"><video class="artwork-video" src="${escapeHtml(item.imageUrl)}" controls playsinline preload="metadata"></video></div>`
          : `<div class="artwork-media" onclick="openLightbox('${escapeHtml(item.imageUrl)}')"><img src="${escapeHtml(item.imageUrl)}" alt="作品" loading="lazy" /></div>`
        : `<div class="artwork-media artwork-media-fail">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
          </div>`;
      return `
      <div class="artwork-card">
        ${media}
        <div class="artwork-body">
          <div class="artwork-head">
            <span class="badge ${ok ? "badge-success" : "badge-failed"}">${ok ? "成功" : "失败"}</span>
            <span class="artwork-model">${escapeHtml(item.model)}</span>
          </div>
          <div class="artwork-meta">${showUser ? `${escapeHtml(creationUserLabel(item))} · ` : ""}${money(item.chargeCents)} · ${formatTime(item.createdAt)}</div>
          <p class="artwork-prompt" title="${escapeHtml(stripAuthStatement(item.errorMessage || item.prompt || ""))}">${escapeHtml(stripAuthStatement(item.errorMessage || item.prompt || ""))}</p>
          <div class="artwork-actions">
            <button class="small-button" type="button" onclick="creationReuse(${index})">复用</button>
            ${item.imageUrl ? `<button class="small-button" type="button" onclick="creationDownload(${index})">下载</button>` : ""}
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function creationUserLabel(item) {
  const name = item.userName || item.userEmail || `用户 ${item.userId || ""}`.trim();
  return item.userPhone ? `${name} · ${item.userPhone}` : name;
}

window.creationReuse = function creationReuse(index) {
  const item = state.creationsCache[index];
  if (!item) return;
  $("#studioPrompt").value = stripAuthStatement(item.prompt || "");
  switchView("studio");
  $("#studioPrompt").focus();
  showNotice("Prompt 已带入生成页", "success");
};

window.creationDownload = function creationDownload(index) {
  const item = state.creationsCache[index];
  if (!item?.imageUrl) return;
  const anchor = document.createElement("a");
  anchor.href = item.imageUrl;
  anchor.download = isVideoCreation(item) ? `ai-photo-video-${item.id || index}.mp4` : `ai-photo-${item.id || index}.png`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

/* ----- 历史页：粒度切换与分组 ----- */
function renderHistGranularityChips() {
  const container = $("#histGranularity");
  if (!container) return;
  const options = [
    { key: "day", label: "按日" },
    { key: "week", label: "按周" },
    { key: "month", label: "按月" },
  ];
  container.innerHTML = options
    .map((opt) => `<button type="button" class="chip ${state.histFilter.granularity === opt.key ? "active" : ""}" data-granularity="${opt.key}">${opt.label}</button>`)
    .join("");
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.histFilter.granularity = chip.dataset.granularity;
      renderHistory();
    });
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function walletGroupKey(dateValue, granularity) {
  const parts = beijingDateParts(dateValue);
  if (!parts) return { key: "unknown", label: "未知日期" };
  const y = parts.year;
  const m = pad2(parts.month);
  const d = pad2(parts.day);
  if (granularity === "month") {
    return { key: `${y}-${m}`, label: `${y}年${Number(m)}月` };
  }
  if (granularity === "week") {
    // 以周一为一周起点
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const monday = new Date(calendarDate);
    monday.setUTCDate(calendarDate.getUTCDate() - ((calendarDate.getUTCDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (dt) => `${pad2(dt.getUTCMonth() + 1)}.${pad2(dt.getUTCDate())}`;
    return {
      key: `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`,
      label: `${monday.getUTCFullYear()}年 ${fmt(monday)} – ${fmt(sunday)} 周`,
    };
  }
  return { key: `${y}-${m}-${d}`, label: `${y}-${m}-${d}` };
}

function groupWalletEntries(entries, granularity) {
  const groups = new Map();
  for (const entry of entries) {
    const { key, label } = walletGroupKey(entry.createdAt, granularity);
    if (!groups.has(key)) groups.set(key, { key, label, entries: [], rechargeCents: 0, consumeCents: 0 });
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.type === "consume") group.consumeCents += Math.abs(Number(entry.amountCents));
    else group.rechargeCents += Math.abs(Number(entry.amountCents));
  }
  return [...groups.values()];
}

function renderWalletGroup(group, open) {
  const showUser = state.user?.role === "admin";
  const rows = group.entries
    .map((w) => {
      const isConsume = w.type === "consume";
      const label = w.type === "recharge" ? "充值" : w.type === "refund" ? "退款" : "消费";
      return `
      <tr>
        <td><span class="badge ${isConsume ? "badge-num" : "badge-success"}">${label}</span></td>
        ${showUser ? `<td>${escapeHtml(walletUserLabel(w))}</td>` : ""}
        <td class="num ${isConsume ? "amount-neg" : "amount-pos"}">${isConsume ? "−" : "+"}${money(Math.abs(Number(w.amountCents)))}</td>
        <td class="num">${money(w.balanceAfterCents)}</td>
        <td class="num">${formatTime(w.createdAt)}</td>
        <td>${escapeHtml(w.note || "—")}</td>
      </tr>`;
    })
    .join("");
  return `
    <details class="wallet-group" ${open ? "open" : ""}>
      <summary>
        <svg class="group-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        <span class="group-label">${escapeHtml(group.label)} <span class="group-count">· ${group.entries.length} 笔</span></span>
        <span class="group-sums">
          ${group.rechargeCents ? `<span class="amount-pos">+${money(group.rechargeCents)}</span>` : ""}
          ${group.consumeCents ? `<span class="amount-neg">−${money(group.consumeCents)}</span>` : ""}
        </span>
      </summary>
      <table>
        <thead><tr><th>类型</th>${showUser ? "<th>用户</th>" : ""}<th>金额</th><th>余额</th><th>北京时间</th><th>备注</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function walletUserLabel(wallet) {
  const name = wallet.userName || wallet.userEmail || `用户 ${wallet.userId || ""}`.trim();
  return wallet.userPhone ? `${name} · ${wallet.userPhone}` : name;
}

/* 刷新后恢复上次停留的页面（管理员页需有权限才恢复） */
function restoreLastView() {
  const saved = localStorage.getItem("app_view");
  if (!saved || saved === "cases" || !VIEW_META[saved]) return;
  if (["account", "settings", "finance"].includes(saved) && state.user?.role !== "admin") return;
  switchView(saved);
}

function switchView(view) {
  // 管理员专属页面守卫
  if (["account", "settings", "finance"].includes(view) && state.user?.role !== "admin") {
    showNotice("该页面仅管理员可见", "error");
    view = "cases";
  }
  const sameView = state.view === view;
  if (sameView && view !== "cases") return;
  const previousView = state.view;
  state.view = view;
  document.body.dataset.view = view;
  localStorage.setItem("app_view", view); // 刷新后停留在当前页
  const main = $(".main");
  if (!sameView) {
    document.querySelectorAll(".nav-item").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    document.querySelectorAll(".view").forEach((panel) =>
      panel.classList.toggle("active", panel.id === `${view}View`)
    );
    const meta = VIEW_META[view] || {};
    document.title = meta.title ? `AI 照相馆 · ${meta.title}` : "AI 照相馆";
  }
  if ((view === "history" || view === "billing") && !sameView) renderHistory();
  if (view === "finance") renderFinance();
  if (view === "cases") {
    state.category = "all";
    if ($("#caseSearch")) $("#caseSearch").value = "";
    renderCategoryChips();
    showGallerySkeleton();
    refreshCases().catch((error) => {
      $("#gallery").innerHTML = `<div class="empty-state"><strong>案例库加载失败</strong><p>${escapeHtml(error.message)}</p></div>`;
      showNotice(`案例库加载失败：${error.message}`, "error");
    });
  }
  if (view === "settings" && !sameView) renderSettings();
  if (view === "studio") {
    requestAnimationFrame(autoResizePromptInput);
    scrollTimelineToEnd(previousView === "studio" ? "smooth" : "auto");
  } else if (main) {
    main.scrollTo({ top: 0, behavior: "auto" });
  }
}

/* ---------- 提示词辅助 ---------- */
function selectedPromptHelperParts() {
  return [
    $("#promptAspect").value,
    $("#promptStyle").value,
    $("#promptQuality").value,
    $("#promptPalette").value,
    $("#promptLighting").value,
    $("#promptEnvironment").value,
    $("#promptComposition").value,
  ].filter(Boolean);
}

function appendPromptHelper() {
  const parts = selectedPromptHelperParts();
  if (!parts.length) {
    throwNotice("请先选择至少一个提示词辅助项");
  }
  const textarea = $("#studioPrompt");
  setStudioPromptValue([textarea.value.trim(), parts.join("，")].filter(Boolean).join("\n\n"));
  syncAuthorizationStatement();
  $("#promptToolsDialog").close();
  showNotice("已追加到 Prompt", "success");
}

function composePromptHelper() {
  const parts = selectedPromptHelperParts();
  const current = stripAuthStatement($("#studioPrompt").value.trim()) || "请在这里描述主体、动作、产品、人物或场景";
  setStudioPromptValue([
    `主体与目标：${current}`,
    `视觉要求：${parts.join("，") || "写实、清晰、主体突出"}`,
    "构图要求：主体明确，层次清楚，避免杂乱元素。",
    "输出要求：高质量图片，细节完整，无水印，无多余文字。",
  ].join("\n"));
  syncAuthorizationStatement();
  $("#promptToolsDialog").close();
  showNotice("已生成结构化 Prompt", "success");
}

function syncAuthorizationStatement() {
  const enabled = $("#authorizationConfirmed").checked;
  setStudioPromptValue(withAuthorizationStatement($("#studioPrompt").value, enabled));
}

function withAuthorizationStatement(prompt, enabled) {
  const cleaned = stripAuthStatement(prompt);
  if (!enabled) return cleaned;
  return `${AUTHORIZATION_STATEMENT}\n\n${cleaned}`.trim();
}

const MAX_REFERENCE_IMAGES = 6;
const MAX_REFERENCE_VIDEOS = 1;

/* 追加式多图上传：再次选择是「追加」而非替换 */
function addReferenceFiles() {
  const input = $("#referenceImage");
  const incoming = Array.from(input.files || []);
  input.value = ""; // 清空 input，确保再次选择同一文件也能触发 change
  if (!incoming.length) return;

  let addedReferenceFile = false;
  let addedReferenceVideo = false;
  for (const file of incoming) {
    const isVideo = file.type?.startsWith("video/");
    const target = isVideo ? state.referenceVideos : state.referenceFiles;
    const duplicated = target.some(
      (existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified
    );
    if (duplicated) continue;
    if (isVideo && state.referenceVideos.length >= MAX_REFERENCE_VIDEOS) {
      showNotice(`最多上传 ${MAX_REFERENCE_VIDEOS} 个参考视频`, "error");
      break;
    }
    if (!isVideo && state.referenceFiles.length >= MAX_REFERENCE_IMAGES) {
      showNotice(`最多上传 ${MAX_REFERENCE_IMAGES} 张参考图`, "error");
      break;
    }
    target.push(file);
    if (isVideo) addedReferenceVideo = true;
    else addedReferenceFile = true;
  }
  if (addedReferenceVideo) setGenerationMode("videoVideo");
  else if (addedReferenceFile && state.generationMode === "video") setGenerationMode("imageVideo");
  else if (addedReferenceFile && state.generationMode === "text") setGenerationMode("image");
  renderReferencePreview();
}

function renderReferencePreview() {
  const preview = $("#referencePreview");
  const files = state.referenceFiles;
  const videos = state.referenceVideos;
  if (!files.length && !videos.length) {
    preview.hidden = true;
    preview.innerHTML = "";
    clearMaskCanvas();
    updateMaskEditor();
    return;
  }
  preview.hidden = false;
  const imageCards = files
    .map(
      (file, index) => `
    <div class="upload-card" title="${escapeHtml(file.name)}">
      <img src="${URL.createObjectURL(file)}" alt="参考图 ${index + 1}" />
      ${index === 0 && state.generationMode === "inpaint" ? `<span class="upload-tag">原图</span>` : ""}
      <button class="card-remove" type="button" onclick="removeReferenceImage(${index})" aria-label="移除参考图">✕</button>
    </div>`
    )
    .join("");
  const videoCards = videos
    .map(
      (file, index) => `
    <div class="upload-card upload-video-card" title="${escapeHtml(file.name)}">
      <video src="${URL.createObjectURL(file)}" muted playsinline preload="metadata"></video>
      <span class="upload-tag">视频</span>
      <button class="card-remove" type="button" onclick="removeReferenceVideo(${index})" aria-label="移除参考视频">✕</button>
    </div>`
    )
    .join("");
  const parts = [];
  if (files.length) parts.push(`${files.length} / ${MAX_REFERENCE_IMAGES} 张图`);
  if (videos.length) parts.push(`${videos.length} / ${MAX_REFERENCE_VIDEOS} 个视频`);
  preview.innerHTML = imageCards + videoCards + `<span class="upload-name">${parts.join(" · ")}</span>`;
  updateMaskEditor(files[0]);
}

window.removeReferenceImage = function removeReferenceImage(index) {
  if (typeof index === "number") state.referenceFiles.splice(index, 1);
  else state.referenceFiles = [];
  $("#referenceImage").value = "";
  if (!state.referenceFiles.length) clearMaskCanvas();
  renderReferencePreview();
};

window.removeReferenceVideo = function removeReferenceVideo(index) {
  if (typeof index === "number") state.referenceVideos.splice(index, 1);
  else state.referenceVideos = [];
  $("#referenceImage").value = "";
  renderReferencePreview();
};

function isVideoGenerationMode(mode) {
  return ["video", "imageVideo", "videoVideo"].includes(mode);
}

function setGenerationMode(mode) {
  state.generationMode = ["text", "image", "inpaint", "video", "imageVideo", "videoVideo"].includes(mode) ? mode : "text";
  document.querySelectorAll("[data-generation-mode]").forEach((button) => {
    const active = button.dataset.generationMode === state.generationMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const dropzone = $("#dropzone");
  if (dropzone) {
    dropzone.title =
      state.generationMode === "text"
        ? "文生图无需上传；切换到文+图或局部重绘后上传图片"
        : state.generationMode === "image"
          ? "上传参考图（PNG/JPG/WebP ≤12MB）"
          : state.generationMode === "video"
            ? "可选上传参考图作为视频首帧或风格参考"
            : state.generationMode === "imageVideo"
              ? "上传参考图生成视频（PNG/JPG/WebP ≤12MB）"
              : state.generationMode === "videoVideo"
                ? "上传参考视频生成新视频（MP4/WebM/MOV）"
            : "上传原图后涂抹需要局部重绘的区域";
  }
  const videoOptions = $("#videoOptions");
  if (videoOptions) videoOptions.hidden = !isVideoGenerationMode(state.generationMode);
  updateMaskEditor(state.referenceFiles[0]);
}

function updateMaskEditor(file = state.referenceFiles[0]) {
  const editor = $("#maskEditor");
  if (!editor) return;
  const shouldShow = state.generationMode === "inpaint" && Boolean(file);
  editor.hidden = !shouldShow;
  if (!shouldShow) return;

  const image = $("#maskBaseImage");
  image.src = URL.createObjectURL(file);
  image.onload = () => {
    clearMaskCanvas();
    renderMaskCanvas();
  };
}

function bindMaskCanvasEvents() {
  const canvas = $("#maskCanvas");
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (event) => {
    if (state.generationMode !== "inpaint") return;
    maskState.drawing = true;
    canvas.setPointerCapture(event.pointerId);
    addMaskStroke(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!maskState.drawing) return;
    addMaskStroke(event);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    canvas.addEventListener(type, () => {
      maskState.drawing = false;
    });
  });
}

function addMaskStroke(event) {
  const canvas = $("#maskCanvas");
  const rect = canvas.getBoundingClientRect();
  const size = Number($("#maskBrushSize").value || 32);
  maskState.strokes.push({
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    size,
  });
  renderMaskCanvas();
}

function renderMaskCanvas() {
  const canvas = $("#maskCanvas");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(239, 68, 68, 0.48)";
  for (const stroke of maskState.strokes) {
    context.beginPath();
    context.arc(stroke.x, stroke.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  }
}

function clearMaskCanvas() {
  maskState.strokes = [];
  renderMaskCanvas();
}

async function createMaskBlob() {
  const source = $("#maskCanvas");
  const mask = document.createElement("canvas");
  mask.width = source.width;
  mask.height = source.height;
  const context = mask.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, mask.width, mask.height);
  context.globalCompositeOperation = "destination-out";
  for (const stroke of maskState.strokes) {
    context.beginPath();
    context.arc(stroke.x, stroke.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  }
  return new Promise((resolve, reject) => {
    mask.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("蒙版生成失败"));
    }, "image/png");
  });
}

/* ---------- 在线支付：充值 / 单次付费 / 财务 ---------- */
const payState = {
  pollTimer: null,
  orderNo: null,
  onPaid: null,
  channels: [],
  chosenChannel: null,
  rcAmountCents: 5000,
  pendingPaygen: null,
};

const CHANNEL_ICONS = {
  alipay: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 9h10M9.5 6.5 12 9l-4.5 8M16 17c-3-1.5-6.5-3.5-9-3"/></svg>`,
  wechat: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 13.5A5.5 5 0 1 1 14 8.7"/><path d="M9.8 11a5.2 4.6 0 1 0 8 4.6l1.7 1.2-.6-2.3a4.6 4.6 0 0 0-9.1-3.5z"/></svg>`,
};

async function fetchEnabledChannels() {
  const result = await api("/api/payments/channels");
  payState.channels = result.channels || [];
  return payState.channels;
}

/* ----- 在线充值 ----- */
const RC_PRESETS = [1000, 5000, 10000, 50000];

async function openRechargeDialog() {
  const channels = await fetchEnabledChannels();
  if (!channels.length) throwNotice("管理员尚未启用任何支付渠道，暂不支持在线充值");
  payState.chosenChannel = channels[0].channel;
  payState.rcAmountCents = RC_PRESETS[1];
  $("#rcAmount").value = "";
  renderRechargeDialog();
  $("#userDialog").close();
  $("#rechargeDialog").showModal();
}

function renderRechargeDialog() {
  $("#rcAmountChips").innerHTML = RC_PRESETS.map(
    (cents) =>
      `<button type="button" class="chip amount-chip ${payState.rcAmountCents === cents && !$("#rcAmount").value ? "active" : ""}" data-cents="${cents}">¥${cents / 100}</button>`
  ).join("");
  document.querySelectorAll("#rcAmountChips .amount-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      payState.rcAmountCents = Number(chip.dataset.cents);
      $("#rcAmount").value = "";
      renderRechargeDialog();
    });
  });
  $("#rcChannelChips").innerHTML = payState.channels
    .map(
      (ch) =>
        `<button type="button" class="chip channel-chip ${ch.channel} ${payState.chosenChannel === ch.channel ? "active" : ""}" data-channel="${ch.channel}">${CHANNEL_ICONS[ch.channel] || ""}${escapeHtml(ch.channelName)}${ch.mode === "mock" ? " · 模拟" : ""}</button>`
    )
    .join("");
  document.querySelectorAll("#rcChannelChips .channel-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      payState.chosenChannel = chip.dataset.channel;
      renderRechargeDialog();
    });
  });
}

async function submitRecharge() {
  const custom = $("#rcAmount").value.trim();
  const amountYuan = custom ? Number(custom) : payState.rcAmountCents / 100;
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) throwNotice("请输入有效的充值金额");
  const button = $("#rcPayButton");
  button.disabled = true;
  try {
    const order = await api("/api/payments/orders", {
      method: "POST",
      body: JSON.stringify({ type: "recharge", channel: payState.chosenChannel, amountYuan: String(amountYuan), userId: state.user.id }),
    });
    $("#rechargeDialog").close();
    showPayQr(order, {
      title: "扫码充值",
      onPaid: (status) => {
        if (status.balanceCents != null) {
          state.user.balanceCents = status.balanceCents;
          localStorage.setItem("prompt_user", JSON.stringify(state.user));
          renderUser();
        }
        renderHistory();
        showNotice(`充值成功，已到账 ${money(status.amountCents)}`, "success");
      },
    });
  } finally {
    button.disabled = false;
  }
}

/* ----- 单次付费生成 ----- */
async function startPayPerGeneration({ priceCents, modelDisplayName }) {
  const channels = await fetchEnabledChannels();
  if (!channels.length) {
    throwNotice(`余额不足（本次需 ${money(priceCents)}），且管理员尚未启用在线支付，请联系管理员充值`);
  }
  payState.chosenChannel = channels[0].channel;
  payState.pendingPaygen = { priceCents, modelDisplayName };
  $("#payQrTitle").textContent = "单次付费生成";
  $("#payQrSubtitle").textContent = "余额不足，本次生成需单独支付，支付成功后自动开始生成";
  $("#payChooseAmount").textContent = money(priceCents);
  renderPgChannelChips();
  $("#payChooseSection").hidden = false;
  $("#payQrSection").hidden = true;
  if (!$("#payQrDialog").open) $("#payQrDialog").showModal();
}

function renderPgChannelChips() {
  $("#pgChannelChips").innerHTML = payState.channels
    .map(
      (ch) =>
        `<button type="button" class="chip channel-chip ${ch.channel} ${payState.chosenChannel === ch.channel ? "active" : ""}" data-channel="${ch.channel}">${CHANNEL_ICONS[ch.channel] || ""}${escapeHtml(ch.channelName)}${ch.mode === "mock" ? " · 模拟" : ""}</button>`
    )
    .join("");
  document.querySelectorAll("#pgChannelChips .channel-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      payState.chosenChannel = chip.dataset.channel;
      renderPgChannelChips();
    });
  });
}

async function submitPayPerGeneration() {
  const pending = payState.pendingPaygen;
  if (!pending) return;
  const button = $("#pgPayButton");
  button.disabled = true;
  try {
    const order = await api("/api/payments/orders", {
      method: "POST",
      body: JSON.stringify({
        type: "paygen",
        channel: payState.chosenChannel,
        amountYuan: String(pending.priceCents / 100),
        userId: state.user.id,
        subject: `AI照相馆-单次生成 ${pending.modelDisplayName}`,
      }),
    });
    showPayQr(order, {
      title: "单次付费生成",
      onPaid: () => {
        showNotice("支付成功，开始生成…", "success");
        performGenerate(order.orderNo);
      },
    });
  } finally {
    button.disabled = false;
  }
}

/* ----- 扫码弹窗与轮询 ----- */
function showPayQr(order, { title, onPaid }) {
  payState.orderNo = order.orderNo;
  payState.onPaid = onPaid;
  $("#payQrTitle").textContent = title || "扫码支付";
  $("#payQrSubtitle").textContent =
    order.mode === "mock"
      ? "模拟模式：点击下方按钮即可模拟支付成功"
      : `请使用${order.channel === "alipay" ? "支付宝" : "微信"} App 扫码完成支付`;
  $("#payChooseSection").hidden = true;
  $("#payQrSection").hidden = false;
  $("#payQrAmount").textContent = money(order.amountCents);

  const box = $("#payQrBox");
  if (order.qrDataUrl) {
    box.innerHTML = `<img src="${order.qrDataUrl}" alt="付款二维码" />`;
  } else if (order.mode === "mock") {
    box.innerHTML = `
      <div class="qr-mock">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M20 20h1"/></svg>
        模拟付款码<br/><span style="font-weight:400;font-size:11px;color:#6b6b80">${escapeHtml(order.orderNo)}</span>
      </div>`;
  } else {
    box.innerHTML = `<div class="qr-fallback">二维码组件未安装（运行 npm install 后重启服务即可）。<br/><br/>付款链接：${escapeHtml(order.qrText || "")}</div>`;
  }

  setPayStatus("pending");
  $("#simulatePayButton").hidden = order.mode !== "mock";
  if (!$("#payQrDialog").open) $("#payQrDialog").showModal();
  startPayPolling();
}

function setPayStatus(status) {
  const el = $("#payQrStatus");
  el.classList.toggle("paid", status === "paid");
  el.classList.toggle("failed", status === "failed" || status === "expired");
  const text =
    status === "paid" ? "支付成功！" :
    status === "failed" ? "支付失败，请重新发起" :
    status === "expired" ? "订单已关闭，请重新发起" : "等待支付中…";
  el.innerHTML = `<span class="payqr-dot"></span>${text}`;
}

function startPayPolling() {
  stopPayPolling();
  payState.pollTimer = setInterval(async () => {
    if (!payState.orderNo) return;
    try {
      const status = await api(`/api/payments/orders/${payState.orderNo}`);
      if (status.status === "paid") {
        finishPay(status);
      } else if (status.status === "failed" || status.status === "expired") {
        setPayStatus(status.status);
        stopPayPolling();
      }
    } catch {
      /* 网络抖动时静默重试 */
    }
  }, 2000);
}

function stopPayPolling() {
  if (payState.pollTimer) clearInterval(payState.pollTimer);
  payState.pollTimer = null;
}

function finishPay(status) {
  stopPayPolling();
  setPayStatus("paid");
  const onPaid = payState.onPaid;
  payState.onPaid = null;
  payState.orderNo = null;
  setTimeout(() => {
    $("#payQrDialog").close();
    if (onPaid) onPaid(status);
  }, 650);
}

async function simulatePayCurrent() {
  if (!payState.orderNo) return;
  const status = await api(`/api/payments/orders/${payState.orderNo}/simulate`, { method: "POST" });
  finishPay(status);
}

/* ----- 财务页（管理员） ----- */
async function renderFinance() {
  if (state.user?.role !== "admin") {
    $("#payChannelsList").innerHTML = `<div class="empty-state"><strong>仅管理员可访问</strong><p>请使用管理员账号登录</p></div>`;
    return;
  }
  const [cfg, summary] = await Promise.all([api("/api/payments/config"), api("/api/finance/summary")]);
  state.financeConfigs = cfg.channels || [];
  state.paymentCallbackUrls = cfg.callbackUrls || {};
  state.financeSummary = summary;
  $("#financeBalance").textContent = money(summary.balanceCents);
  $("#financeIncome").textContent = money(summary.totalIncomeCents);
  $("#financeWithdrawn").textContent = money(summary.totalWithdrawCents);
  renderPayChannels();
  renderFinanceOrders();
  renderFinanceWithdrawals();
}

function renderPayChannels() {
  $("#payChannelsList").innerHTML = state.financeConfigs
    .map((cfg) => {
      const secretCount = Object.values(cfg.secretsSet || {}).filter(Boolean).length;
      return `
      <div class="provider-card ${cfg.enabled ? "" : "provider-disabled"}">
        <div class="provider-head">
          <div class="provider-icon channel-chip ${cfg.channel}">${CHANNEL_ICONS[cfg.channel] || ""}</div>
          <div class="provider-meta">
            <div class="provider-name">${escapeHtml(cfg.channelName)}</div>
            <div class="provider-sub">${cfg.enabled ? "已启用" : "未启用"} · 密钥${secretCount ? "已配置" : "未配置"}</div>
          </div>
          <span class="${cfg.mode === "mock" ? "mode-tag-mock" : "mode-tag-production"}">${cfg.mode === "mock" ? "模拟模式" : "生产模式"}</span>
          <button class="small-button" onclick="openChannelConfig('${cfg.channel}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            配置
          </button>
        </div>
      </div>`;
    })
    .join("");
}

function renderFinanceOrders() {
  const orders = state.financeSummary?.orders || [];
  $("#financeOrders").innerHTML = orders.length
    ? `<table>
        <thead><tr><th>时间</th><th>类型</th><th>渠道</th><th>用户</th><th>金额</th><th>状态</th></tr></thead>
        <tbody>${orders
          .map((order) => {
            const statusBadge =
              order.status === "paid" ? `<span class="badge badge-success">已支付</span>` :
              order.status === "pending" ? `<span class="badge badge-num">待支付</span>` :
              `<span class="badge badge-failed">${order.status === "expired" ? "已关闭" : "失败"}</span>`;
            return `
            <tr>
              <td class="num">${formatTime(order.createdAt)}</td>
              <td>${order.type === "recharge" ? "充值" : "单次付费"}</td>
              <td>${order.channel === "alipay" ? "支付宝" : "微信"}</td>
              <td>${escapeHtml(order.userName || "—")}</td>
              <td class="num amount-pos">+${money(order.amountCents)}</td>
              <td>${statusBadge}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state" style="padding:32px 14px"><strong>暂无收支记录</strong><p>用户充值或单次付费后这里会出现流水</p></div>`;
}

function renderFinanceWithdrawals() {
  const rows = state.financeSummary?.withdrawals || [];
  $("#financeWithdrawals").innerHTML = rows.length
    ? `<table>
        <thead><tr><th>时间</th><th>金额</th><th>备注</th><th>状态</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (item) => `
          <tr>
            <td class="num">${formatTime(item.createdAt)}</td>
            <td class="num amount-neg">−${money(item.amountCents)}</td>
            <td>${escapeHtml(item.note || "—")}</td>
            <td>${item.status === "done" ? `<span class="badge badge-success">已完成</span>` : `<span class="badge badge-num">待打款</span>`}</td>
            <td style="text-align:right">${item.status === "pending" ? `<button class="small-button" onclick="finishWithdrawal(${item.id})">标记已完成</button>` : ""}</td>
          </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state" style="padding:32px 14px"><strong>暂无提现记录</strong><p>点击右上角「申请提现」创建台账</p></div>`;
}

window.finishWithdrawal = async function finishWithdrawal(id) {
  const ok = await confirmAction("确认已在商户后台完成打款？标记后不可撤销。", { title: "标记提现完成", confirmText: "确认完成", danger: false });
  if (!ok) return;
  await api(`/api/finance/withdrawals/${id}/done`, { method: "PATCH" });
  await renderFinance();
  showNotice("提现已标记完成", "success");
};

async function submitWithdrawal() {
  const amountYuan = Number($("#wdAmount").value);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) throwNotice("请输入有效的提现金额");
  await api("/api/finance/withdrawals", {
    method: "POST",
    body: JSON.stringify({ amountYuan: String(amountYuan), note: $("#wdNote").value.trim() }),
  });
  $("#withdrawDialog").close();
  await renderFinance();
  showNotice("提现申请已记录", "success");
}

/* ----- 渠道配置弹窗 ----- */
window.openChannelConfig = function openChannelConfig(channel) {
  const cfg = (state.financeConfigs || []).find((item) => item.channel === channel) || { config: {}, secretsSet: {} };
  $("#ccChannel").value = channel;
  $("#channelConfigTitle").textContent = `配置${channel === "alipay" ? "企业支付宝" : "企业微信支付"}`;
  $("#alipayFields").hidden = channel !== "alipay";
  $("#wechatFields").hidden = channel !== "wechat";

  const secretPlaceholder = (key, fallback) => (cfg.secretsSet?.[key] ? "已保存，留空表示不修改" : fallback);
  if (channel === "alipay") {
    $("#ccAlipayAppId").value = cfg.config.appId || "";
    $("#ccAlipayPrivateKey").value = "";
    $("#ccAlipayPrivateKey").placeholder = secretPlaceholder("privateKey", "可直接粘贴纯 base64 或完整 PEM");
    $("#ccAlipayPublicKey").value = "";
    $("#ccAlipayPublicKey").placeholder = secretPlaceholder("alipayPublicKey", "支付宝公钥（验签用）");
    $("#ccAlipayGateway").value = cfg.config.gateway || "";
    $("#ccAlipayNotifyUrl").value = cfg.config.notifyUrl || callbackUrlForChannel("alipay");
  } else {
    $("#ccWechatMchId").value = cfg.config.mchId || "";
    $("#ccWechatAppId").value = cfg.config.appId || "";
    $("#ccWechatSerialNo").value = cfg.config.serialNo || "";
    $("#ccWechatPrivateKey").value = "";
    $("#ccWechatPrivateKey").placeholder = secretPlaceholder("privateKey", "可直接粘贴纯 base64 或完整 PEM");
    $("#ccWechatApiV3Key").value = "";
    $("#ccWechatApiV3Key").placeholder = secretPlaceholder("apiV3Key", "32 位 APIv3 密钥");
    $("#ccWechatNotifyUrl").value = cfg.config.notifyUrl || callbackUrlForChannel("wechat");
  }
  $("#ccMode").value = cfg.mode || "mock";
  $("#ccEnabled").checked = Boolean(cfg.enabled);
  $("#channelConfigDialog").showModal();
};

async function saveChannelConfig() {
  const channel = $("#ccChannel").value;
  const config =
    channel === "alipay"
      ? {
          appId: $("#ccAlipayAppId").value.trim(),
          privateKey: $("#ccAlipayPrivateKey").value.trim(),
          alipayPublicKey: $("#ccAlipayPublicKey").value.trim(),
          gateway: $("#ccAlipayGateway").value.trim(),
          notifyUrl: $("#ccAlipayNotifyUrl").value.trim(),
        }
      : {
          mchId: $("#ccWechatMchId").value.trim(),
          appId: $("#ccWechatAppId").value.trim(),
          serialNo: $("#ccWechatSerialNo").value.trim(),
          privateKey: $("#ccWechatPrivateKey").value.trim(),
          apiV3Key: $("#ccWechatApiV3Key").value.trim(),
          notifyUrl: $("#ccWechatNotifyUrl").value.trim(),
        };
  const button = $("#ccSaveButton");
  button.disabled = true;
  try {
    await api("/api/payments/config", {
      method: "POST",
      body: JSON.stringify({ channel, enabled: $("#ccEnabled").checked, mode: $("#ccMode").value, config }),
    });
    $("#channelConfigDialog").close();
    await renderFinance();
    showNotice("支付渠道配置已保存", "success");
  } finally {
    button.disabled = false;
  }
}

function callbackUrlForChannel(channel) {
  const saved = state.paymentCallbackUrls?.[channel];
  if (saved) return saved;
  return `${window.location.origin}/api/payments/notify/${channel}`;
}

async function copyCallbackUrl(channel) {
  const selector = channel === "alipay" ? "#ccAlipayNotifyUrl" : "#ccWechatNotifyUrl";
  const value = $(selector)?.value || callbackUrlForChannel(channel);
  await copyText(value);
  showNotice(`${channel === "alipay" ? "支付宝" : "微信支付"}回调地址已复制`, "success");
}

/* ---------- 用户状态 ---------- */
function renderUser() {
  const signedIn = Boolean(state.user);
  $("#signedInUser").hidden = !signedIn;
  $("#authSection").hidden = signedIn;
  if (!signedIn) setAuthTab("login");
  const initial = signedIn ? String(state.user.name || "?").slice(0, 1) : "·";
  $("#userAvatar").textContent = initial;
  $("#dialogAvatar").textContent = initial;
  $("#currentUser").textContent = signedIn ? state.user.name : "未登录";
  $("#currentBalance").textContent = signedIn ? `余额 ${money(state.user.balanceCents)}` : "登录 / 注册";
  $("#dialogUserName").textContent = signedIn ? state.user.name : "未登录";
  $("#dialogUserRole").textContent = signedIn ? `${state.user.email} · ${state.user.role}` : "—";
  $("#dialogBalance").textContent = signedIn ? money(state.user.balanceCents) : "¥0.00";

  // 管理员专属页面：用户 / 供应商 / 支付
  const isAdmin = signedIn && state.user.role === "admin";
  for (const id of ["accountNavItem", "settingsNavItem", "financeNavItem"]) {
    const nav = document.getElementById(id);
    if (nav) nav.hidden = !isAdmin;
  }
  if (!isAdmin && ["account", "settings", "finance"].includes(state.view)) switchView("cases");
}

function logout() {
  state.user = null;
  localStorage.removeItem("prompt_user");
  state.timeline = [];
  stageState.status = "empty"; stageState.imageUrl = null; stageState.videoUrl = null; stageState.prompt = "";
  renderUser();
  renderTimeline();
  renderHistory();
  $("#userDialog").close();
  showNotice("已退出登录", "info");
}

/* ---------- 工具函数 ---------- */
function money(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatTime(value) {
  const parts = beijingDateParts(value);
  if (!parts) return "—";
  return `${parts.month}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function beijingDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(BEIJING_DATE_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const TOAST_ICONS = {
  success: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
  error: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  info: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
};

function showNotice(message, type = "info") {
  const stack = $("#toastStack");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${escapeHtml(message)}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 2600);
  while (stack.children.length > 4) stack.firstElementChild.remove();
}

let confirmResolver = null;

function confirmAction(message, { title = "确认操作", confirmText = "确认删除", danger = true } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    const okButton = $("#confirmOkButton");
    okButton.textContent = confirmText;
    okButton.classList.toggle("btn-danger", danger);
    okButton.classList.toggle("btn-primary", !danger);
    $("#confirmIcon").classList.toggle("confirm-icon-normal", !danger);
    const dialog = $("#confirmDialog");
    dialog.returnValue = "";
    dialog.showModal();
  });
}

function throwNotice(message) {
  showNotice(message, "error");
  const error = new Error(message);
  error.__notified = true;
  throw error;
}

function debounce(fn, wait) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

window.addEventListener("error", (event) => showNotice(event.error?.message || event.message, "error"));
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.__notified) return;
  if (event.reason?.message) showNotice(event.reason.message, "error");
});

window.toggleProvider = async function toggleProvider(id, enabled) {
  await api(`/api/providers/${id}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  await refreshBootstrap();
  renderAll();
  showNotice(enabled ? "供应商已启用" : "供应商已停用", "success");
};
window.removeProvider = async function removeProvider(id) {
  const ok = await confirmAction("删除供应商后，名下所有模型定价会一起删除，且无法恢复。", { title: "删除供应商" });
  if (!ok) return;
  await api(`/api/providers/${id}`, { method: "DELETE" });
  await refreshBootstrap();
  renderAll();
  showNotice("供应商已删除", "success");
};
window.togglePrice = async function togglePrice(id, enabled) {
  await api(`/api/prices/${id}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  await refreshBootstrap();
  renderAll();
  showNotice(enabled ? "模型定价已启用" : "模型定价已停用", "success");
};
window.toggleProviderModel = async function toggleProviderModel(priceId, providerId, enabled) {
  if (enabled && !isProviderEnabled(providerId)) {
    await api(`/api/providers/${providerId}/enabled`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
  }
  await api(`/api/prices/${priceId}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  await refreshBootstrap();
  renderAll();
  showNotice(enabled ? "模型已启用" : "模型已停用", "success");
};
window.removePrice = async function removePrice(id) {
  const ok = await confirmAction("该模型将从生成页下架，确定要删除这条定价吗？", { title: "删除模型定价" });
  if (!ok) return;
  await api(`/api/prices/${id}`, { method: "DELETE" });
  await refreshBootstrap();
  renderAll();
  showNotice("模型定价已删除", "success");
};

init().catch((error) => showNotice(error.message, "error"));
