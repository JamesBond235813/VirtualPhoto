import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("../server/repository.mjs", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../server/schema.mjs", import.meta.url), "utf8");
const openaiCompatibleSource = readFileSync(new URL("../server/openai-compatible.mjs", import.meta.url), "utf8");

test("case gallery actions use delegated handlers instead of fragile inline button calls", () => {
  assert.match(appSource, /on\("gallery", "click", handleCaseAction\)/);
  assert.match(appSource, /function handleCaseAction\(event\)/);
  assert.match(appSource, /data-case-action="language"/);
  assert.match(appSource, /data-case-action="close-detail"/);
  assert.doesNotMatch(appSource, /onclick="usePrompt\(/);
  assert.doesNotMatch(appSource, /onclick="copyPrompt\(/);
  assert.doesNotMatch(appSource, /onclick="openCaseDialog\(/);
  assert.doesNotMatch(appSource, /onclick="removeCase\(/);
  assert.doesNotMatch(appSource, /onclick="switchCasePromptLanguage\(/);
  assert.doesNotMatch(appSource, /onclick="closeCaseDetail\(/);
});

test("entering the case gallery resets filters and refreshes all cases", () => {
  assert.match(appSource, /state\.category = "all";/);
  assert.match(appSource, /\$\("#caseSearch"\)\)\s+\$\("#caseSearch"\)\.value = "";/);
  assert.match(appSource, /showGallerySkeleton\(\);\s*refreshCases\(\)/s);
});

test("frontend resource version is bumped for cache-safe delivery", () => {
  assert.match(indexSource, /styles\.css\?v=2026061[235][a-z0-9]+/);
  assert.match(indexSource, /app\.js\?v=2026061[235][a-z0-9]+/);
});

test("sidebar navigation follows the requested page order and renames finance to payment", () => {
  const navBlock = indexSource.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const views = [...navBlock.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(views.slice(0, 6), ["studio", "billing", "history", "cases", "settings", "finance"]);
  assert.match(navBlock, /data-view="finance"[\s\S]*支付/);
  assert.doesNotMatch(navBlock, /data-view="finance"[\s\S]*财务/);
  assert.match(appSource, /finance: \{ eyebrow: "Pay", title: "支付"/);
});

test("api helper rejects non-json api responses instead of treating html fallback as success", () => {
  assert.match(appSource, /const contentType = response\.headers\.get\("content-type"\) \|\| "";/);
  assert.match(appSource, /const expectsJson = path\.startsWith\("\/api\/"\);/);
  assert.match(appSource, /if \(expectsJson && !contentType\.includes\("application\/json"\)\)/);
  assert.match(appSource, /formatNonJsonApiError\(response\.status\)/);
  assert.match(appSource, /网关超时：上游模型响应过慢，请稍后重试或换一个模型/);
});

test("server returns json errors for unknown api paths before spa fallback", () => {
  assert.match(serverSource, /app\.use\("\/api", \(req, res\) => \{/);
  assert.ok(
    serverSource.indexOf('app.use("/api", (req, res) => {') <
      serverSource.indexOf('res.sendFile(path.join(rootDir, "index.html"))'),
  );
});

test("case reference menu opens with a real expanded category and preview target", () => {
  assert.match(appSource, /function ensureDefaultCaseReferenceState\(\)/);
  assert.match(appSource, /state\.expandedCaseReferenceCategories = new Set\(\[String\(\(expandedVisibleGroup \|\| firstGroup\)\.id\)\]\)/);
  assert.match(appSource, /data-reference-toggle=/);
  assert.match(appSource, /event\.stopPropagation\(\);\s*toggleCaseReferenceCategory\(button\.dataset\.referenceToggle\)/s);
  assert.match(appSource, /state\.expandedCaseReferenceCategories\.delete\(id\)/);
  assert.match(appSource, /button\.addEventListener\("pointerenter", previewCase\)/);
  assert.match(appSource, /button\.addEventListener\("mouseover", previewCase\)/);
  assert.match(appSource, /renderCaseReferencePreview\(getCaseReferencePreviewItem\(\)\)/);
});

test("case gallery fetches paged results and exposes a load more control", () => {
  assert.match(indexSource, /id="galleryLoadMore"/);
  assert.match(appSource, /const CASE_PAGE_SIZE = \d+;/);
  assert.match(appSource, /params\.set\("limit", String\(CASE_PAGE_SIZE\)\)/);
  assert.match(appSource, /params\.set\("offset", String\(offset\)\)/);
  assert.match(appSource, /function renderGalleryLoadMore\(\)/);
  assert.match(appSource, /on\("galleryLoadMore", "click", loadMoreCases\)/);
});

test("new case dialog automatically continues the case number for selected category", () => {
  assert.match(repositorySource, /export async function getNextCaseNumber\(categoryId\)/);
  assert.match(repositorySource, /MAX\(case_number\) AS maxCaseNumber/);
  assert.match(serverSource, /getNextCaseNumber,/);
  assert.match(serverSource, /app\.get\("\/api\/cases\/next-number"/);
  assert.match(appSource, /function bindCaseNumberAutomation\(\)/);
  assert.match(appSource, /bindCaseNumberAutomation\(\);/);
  assert.match(appSource, /async function refreshNextCaseNumber\(\)/);
  assert.match(appSource, /api\(`\/api\/cases\/next-number\?\$\{params\}`\)/);
  assert.match(appSource, /caseNumberInput\.value = result\.nextCaseNumber \|\| "";/);
  assert.match(appSource, /form\.elements\.caseNumber\.dataset\.autoCaseNumber = "true";/);
  assert.match(appSource, /if \(form\.elements\.id\.value\) return;/);
});

test("generation page exposes text, image, and inpaint modes with mask upload support", () => {
  assert.match(indexSource, /class="generation-mode-stack"/);
  assert.match(indexSource, /data-mode-group="image"[\s\S]*data-generation-mode="text"[\s\S]*data-generation-mode="image"[\s\S]*data-generation-mode="inpaint"/);
  assert.match(indexSource, /data-mode-group="video"[\s\S]*data-generation-mode="video"[\s\S]*data-generation-mode="imageVideo"[\s\S]*data-generation-mode="videoVideo"/);
  assert.match(indexSource, /data-generation-mode="text"/);
  assert.match(indexSource, /data-generation-mode="image"/);
  assert.match(indexSource, /data-generation-mode="inpaint"/);
  assert.match(indexSource, /data-generation-mode="video"/);
  assert.match(indexSource, /data-generation-mode="imageVideo"/);
  assert.match(indexSource, /data-generation-mode="videoVideo"/);
  assert.match(indexSource, /图生视频/);
  assert.match(indexSource, /视频生视频/);
  assert.match(indexSource, /accept="[^"]*video\/mp4/);
  assert.match(indexSource, /id="videoOptions"/);
  assert.match(indexSource, /id="maskCanvas"/);
  assert.match(indexSource, /class="toolbar-stack model-reference-stack"[\s\S]*id="studioPrice"[\s\S]*id="caseReferenceButton"/);
  assert.match(indexSource, /class="toolbar-stack prompt-action-stack"[\s\S]*id="openPromptTools"[\s\S]*id="derivePromptButton"/);
  assert.match(indexSource, /<div class="toolbar-left">[\s\S]*id="authorizationConfirmed"[\s\S]*<div class="toolbar-actions">[\s\S]*id="clearPromptButton"[\s\S]*id="generateButton"[\s\S]*<\/div>[\s\S]*<\/div>\s*<\/div>/);
  assert.doesNotMatch(indexSource, /<div class="toolbar-right">/);
  assert.match(appSource, /formData\.append\("generationMode", state\.generationMode\)/);
  assert.match(appSource, /formData\.append\("maskImage", await createMaskBlob\(\), "mask\.png"\)/);
  assert.match(stylesSource, /\.generation-mode-stack\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(stylesSource, /\.toolbar-stack\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(stylesSource, /\.toolbar-stack\s*\{[^}]*background:/s);
  assert.match(stylesSource, /\.toolbar-actions\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(stylesSource, /\.mode-segment\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(68px, auto\)\)/s);
});

test("video generation uses a task endpoint and polls until finished", () => {
  assert.match(appSource, /if \(isVideoGenerationMode\(state\.generationMode\)\) \{[\s\S]*await performVideoGenerate\(\);[\s\S]*return;/);
  assert.match(appSource, /api\("\/api\/video\/generate", \{ method: "POST", body: formData, headers: \{\} \}\)/);
  assert.match(appSource, /api\(`\/api\/video\/tasks\/\$\{task\.id\}\?userId=\$\{encodeURIComponent\(state\.user\.id\)\}`\)/);
  assert.match(appSource, /stageState\.videoUrl = result\.videoUrl;/);
  assert.match(appSource, /<video id="stageVideo"/);
});

test("image-to-video and video-to-video validate and submit the right uploads", () => {
  assert.match(appSource, /function isVideoGenerationMode\(mode\)/);
  assert.match(appSource, /if \(state\.generationMode === "imageVideo" && !state\.referenceFiles\.length\)/);
  assert.match(appSource, /if \(state\.generationMode === "videoVideo" && !state\.referenceVideos\.length\)/);
  assert.match(appSource, /formData\.append\("videoMode", state\.generationMode\)/);
  assert.match(appSource, /for \(const file of referenceImages\) formData\.append\("referenceImage", file\)/);
  assert.match(appSource, /for \(const file of referenceVideos\) formData\.append\("referenceVideo", file\)/);
  assert.match(serverSource, /\{ name: "referenceVideo", maxCount: 1 \}/);
  assert.match(serverSource, /videoMode: req\.body\.videoMode \|\| "video"/);
});

test("uploading a reference image automatically selects image generation mode", () => {
  assert.match(
    appSource,
    /function addReferenceFiles\(\)[\s\S]*let addedReferenceFile = false;[\s\S]*addedReferenceFile = true;[\s\S]*if \(addedReferenceFile && state\.generationMode === "text"\) setGenerationMode\("image"\);[\s\S]*renderReferencePreview\(\);/,
  );
});

test("image generation can fall back from unstable gpt image edits to an enabled multimodal image model", () => {
  assert.match(serverSource, /async function getFallbackImageGenerationContext\(userId\)/);
  assert.match(serverSource, /async function chooseStableImagePrice\(\{ price, generationMode \}\)/);
  assert.match(serverSource, /generationMode === "image"/);
  assert.match(serverSource, /gemini|flash-image|nano-?banana|seedream|seededit/);
  assert.match(serverSource, /isUnstableImageEditModel\(price\.model\)/);
});

test("generation model selector ignores prices from disabled providers", () => {
  assert.match(appSource, /function generationPrices\(\)/);
  assert.match(appSource, /isProviderEnabled\(price\.providerId\)/);
  assert.match(appSource, /const enabledPrices = generationPrices\(\)/);
  assert.match(appSource, /const price = generationPrices\(\)\.find\(\(p\) => p\.displayName === modelDisplayName\)/);
});

test("derive prompt routes the vision model through its matching enabled provider", () => {
  assert.match(serverSource, /async function getProviderCredentialForModel\(model\)/);
  assert.match(serverSource, /FROM providers p\s+LEFT JOIN model_prices mp ON mp\.provider_id = p\.id AND mp\.enabled = 1/s);
  assert.match(serverSource, /WHERE p\.enabled = 1\s+AND \(p\.default_model = :model OR mp\.model = :model OR mp\.display_name = :model\)/s);
  assert.match(serverSource, /const model = process\.env\.DERIVE_MODEL \|\| process\.env\.TRANSLATE_MODEL \|\| "gpt-4o-mini";\s+const \{ apiKey, chatEndpoint \} = await getProviderCredentialForModel\(model\);/s);
  assert.doesNotMatch(serverSource, /async function getEnabledProviderCredential\(\)[\s\S]*ORDER BY id LIMIT 1/);
});

test("provider settings render one compact row per model", () => {
  assert.match(appSource, /function providerModelRows\(\)/);
  assert.match(appSource, /<table class="provider-model-table"/);
  for (const header of ["供应商", "展示名称", "模型", "单价", "启用开关", "编辑", "删除"]) {
    assert.match(appSource, new RegExp(`<th[^>]*>${header}</th>`));
  }
  assert.match(appSource, /function renderProviderModelRow\(price\)/);
  assert.match(appSource, /toggleProviderModel\(\$\{price\.id\}, \$\{price\.providerId\}, this\.checked\)/);
  assert.match(appSource, /window\.toggleProviderModel = async function toggleProviderModel\(priceId, providerId, enabled\)/);
  assert.match(appSource, /editProvider\(\$\{price\.providerId\}\)/);
  assert.match(appSource, /removePrice\(\$\{price\.id\}\)/);
});

test("case prompt language tabs switch between original and Chinese instead of stacking both", () => {
  assert.match(appSource, /function splitCasePromptText\(prompt\)/);
  assert.match(appSource, /const parts = splitCasePromptText\(item\.prompt\)/);
  assert.match(appSource, /return parts\.zh \|\| state\.promptTranslations\[item\.id\] \|\| parts\.original/);
  assert.match(appSource, /return parts\.original/);
  assert.match(appSource, /body: JSON\.stringify\(\{ text: splitCasePromptText\(item\.prompt\)\.original \}\)/);
});

test("generation mode selector has a strong active state", () => {
  assert.match(stylesSource, /\.mode-option\.active\s*\{[^}]*linear-gradient/s);
  assert.match(stylesSource, /\.mode-option\.active\s*\{[^}]*color:\s*#fff/s);
  assert.match(stylesSource, /\.mode-option\.active\s*\{[^}]*box-shadow:\s*0 10px 24px rgba\(124, 58, 237, 0\.28\)/s);
  assert.match(stylesSource, /\.mode-option::before\s*\{/);
  assert.match(stylesSource, /\.mode-option\.active::before\s*\{[^}]*opacity:\s*1/s);
});

test("studio prompt expands while editing and resets immediately on submit", () => {
  assert.match(appSource, /const PROMPT_INPUT_MIN_HEIGHT = \d+;/);
  assert.match(appSource, /const PROMPT_INPUT_MAX_HEIGHT = \d+;/);
  assert.match(appSource, /function autoResizePromptInput\(\)/);
  assert.match(appSource, /function resetPromptInputHeight\(\)/);
  assert.match(appSource, /function setStudioPromptValue\(value, \{ resize = true \} = \{\}\)/);
  assert.match(appSource, /on\("studioPrompt", "input", autoResizePromptInput\)/);
  assert.match(appSource, /async function performGenerate\(payOrderNo = null\)[\s\S]*resetPromptInputHeight\(\);/);
  assert.match(stylesSource, /\.composer-input\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(stylesSource, /\.composer-input\s*\{[^}]*transition:\s*height var\(--transition-smooth\)/s);
});

test("admin user creation keeps a stable form reference and handles api failures", () => {
  assert.match(appSource, /async function createUser\(event\) \{\s*event\.preventDefault\(\);\s*const form = event\.currentTarget;/s);
  assert.match(appSource, /catch \(error\) \{\s*showNotice\(`用户创建失败：\$\{error\.message\}`, "error"\);\s*return;\s*\}/s);
  assert.match(appSource, /form\.reset\(\);\s*\$\("#userCreateDialog"\)\.close\(\);/s);
  assert.doesNotMatch(appSource, /await api\("\/api\/users"[\s\S]*event\.currentTarget\.reset\(\);/);
});

test("admin create user endpoint returns a friendly duplicate-account error", () => {
  assert.match(serverSource, /app\.post\("\/api\/users", asyncHandler\(async \(req, res\) => \{\s*try \{/s);
  assert.match(serverSource, /if \(error\?\.code === "ER_DUP_ENTRY"\) throw new Error\("该账号已存在，请换一个账号"\);/);
});

test("admin user table displays registered phone numbers", () => {
  assert.match(repositorySource, /SELECT id, email, name, phone, role, balance_cents AS balanceCents FROM users ORDER BY id/);
  assert.match(appSource, /<th>手机号<\/th>/);
  assert.match(appSource, /\$\{escapeHtml\(u\.phone \|\| "未填写"\)\}/);
});

test("billing times are rendered with Beijing timezone", () => {
  assert.match(appSource, /const BEIJING_TIME_ZONE = "Asia\/Shanghai";/);
  assert.match(appSource, /timeZone: BEIJING_TIME_ZONE/);
  assert.match(appSource, /function beijingDateParts\(value\)/);
  assert.match(appSource, /function formatTime\(value\)[\s\S]*beijingDateParts\(value\)/);
  assert.match(appSource, /function walletGroupKey\(dateValue, granularity\)[\s\S]*beijingDateParts\(dateValue\)/);
});

test("admin billing wallet includes the user for each transaction", () => {
  assert.match(repositorySource, /const viewer = await getWalletViewer\(userId\);/);
  assert.match(repositorySource, /const clauses = viewer\.role === "admin" \? \[\] : \["w\.user_id = :userId"\];/);
  assert.match(repositorySource, /u\.name AS userName, u\.email AS userEmail, u\.phone AS userPhone/);
  assert.match(appSource, /const showUser = state\.user\?\.role === "admin";/);
  assert.match(appSource, /function walletUserLabel\(wallet\)/);
  assert.match(appSource, /\$\{showUser \? "<th>用户<\/th>" : ""\}/);
  assert.match(appSource, /\$\{showUser \? `<td>\$\{escapeHtml\(walletUserLabel\(w\)\)\}<\/td>` : ""\}/);
});

test("image upstream timeout returns before nginx gateway timeout", () => {
  assert.match(openaiCompatibleSource, /const IMAGE_UPSTREAM_TIMEOUT_MS = Number\(process\.env\.IMAGE_UPSTREAM_TIMEOUT_MS \|\| 240000\);/);
  assert.match(openaiCompatibleSource, /signal: options\.signal \|\| AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(openaiCompatibleSource, /if \(isTimeoutError\(error\)\) throw new Error\("上游连接超时：模型响应过慢，请稍后重试或换一个模型"\);/);
  assert.match(openaiCompatibleSource, /function isTimeoutError\(error\)/);
});

test("generation empty stage reminds portrait users about privacy and authorization", () => {
  assert.match(appSource, /class="empty-fairy-logo"/);
  assert.match(appSource, /src="images\/logo\.svg"/);
  assert.doesNotMatch(appSource, /<path d="M14\.5 4h-5L7 7H4a2 2 0 0 0-2 2v9/);
  assert.match(appSource, /class="stage-privacy-hint"/);
  assert.match(appSource, /<span>上传自己或者他人肖像的<\/span>/);
  assert.match(appSource, /<span>请注意隐私保护<\/span>/);
  assert.match(appSource, /勾选下方「已获人物授权」/);
  assert.doesNotMatch(appSource, /上传真人肖像的，请注意隐私保护/);
  assert.match(stylesSource, /\.empty-fairy-logo\s*\{/);
  assert.match(stylesSource, /\.empty-visual\s*\{[^}]*width:\s*clamp\(120px, 10vw, 150px\)/s);
  assert.match(stylesSource, /\.empty-orb\s*\{[^}]*background:\s*transparent/s);
  assert.match(stylesSource, /\.empty-orb\s*\{[^}]*border:\s*0/s);
  assert.match(stylesSource, /\.empty-orb\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(stylesSource, /\.empty-orb\s*\{[^}]*animation:\s*none/s);
  assert.match(stylesSource, /\.empty-orb\s*\{[^}]*overflow:\s*visible/s);
  assert.match(stylesSource, /\.empty-fairy-logo\s*\{[^}]*width:\s*clamp\(118px, 9\.5vw, 146px\)/s);
  assert.match(stylesSource, /\.stage-privacy-hint\s*\{/);
  assert.match(stylesSource, /\.stage-privacy-hint\s*\{[^}]*font-size:\s*clamp\(24px, 3\.2vw, 42px\)/s);
  assert.match(stylesSource, /\.stage-privacy-hint\s*\{[^}]*opacity:\s*0\.28/s);
});

test("case use is recorded from gallery and reference picker and exposed for sorting", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS case_usage_events/);
  assert.match(repositorySource, /export function ensureCaseUsageSchema\(\)/);
  assert.match(repositorySource, /export async function recordCaseUse\(/);
  assert.match(repositorySource, /COALESCE\(cu\.useCount, 0\) AS useCount/);
  assert.match(repositorySource, /ORDER BY COALESCE\(cu\.useCount, 0\) DESC, COALESCE\(pc\.case_number, 0\) DESC, pc\.id DESC/);
  assert.match(serverSource, /recordCaseUse,/);
  assert.match(serverSource, /app\.post\("\/api\/cases\/:id\/use"/);
  assert.match(appSource, /async function recordCaseUse\(caseId, source\)/);
  assert.match(appSource, /api\(`\/api\/cases\/\$\{caseId\}\/use`/);
  assert.match(appSource, /recordCaseUse\(item\.id, "reference"\)/);
  assert.match(appSource, /recordCaseUse\(item\.id, "gallery"\)/);
});

test("login dialog openers explicitly choose the visible content panel", () => {
  assert.match(appSource, /if \(state\.user\) showUserDialog\(\);\s*else openAuthDialog\(\);/);
  assert.match(
    appSource,
    /function showUserDialog\(\) \{[\s\S]*\$\("#signedInUser"\)\.hidden = false;[\s\S]*\$\("#authSection"\)\.hidden = true;[\s\S]*\$\("#userDialog"\)\.showModal\(\);[\s\S]*\}/,
  );
  assert.match(
    appSource,
    /function openAuthDialog\(hint = ""\) \{[\s\S]*\$\("#signedInUser"\)\.hidden = true;[\s\S]*\$\("#authSection"\)\.hidden = false;[\s\S]*setAuthTab\("login"\);[\s\S]*\$\("#userDialog"\)\.showModal\(\);[\s\S]*\}/,
  );
});

test("admin creation history can filter all users by user and Beijing date range", () => {
  assert.match(indexSource, /id="creationUserFilter"/);
  assert.match(indexSource, /id="creationFrom"/);
  assert.match(indexSource, /id="creationTo"/);
  assert.match(appSource, /creationQuery: \{ userId: "all", from: "", to: "" \}/);
  assert.match(appSource, /function renderCreationHistoryControls\(\)/);
  assert.match(appSource, /creationParams\.set\("userId", state\.creationQuery\.userId\)/);
  assert.match(appSource, /creationParams\.set\("from", state\.creationQuery\.from\)/);
  assert.match(appSource, /creationParams\.set\("to", state\.creationQuery\.to\)/);
  assert.match(appSource, /function creationUserLabel\(item\)/);
  assert.match(serverSource, /listCreations\(req\.params\.id, \{ userId: req\.query\.userId, from: req\.query\.from, to: req\.query\.to \}\)/);
  assert.match(repositorySource, /export async function listCreations\(viewerId, \{ userId, from, to \} = \{\}\)/);
  assert.match(repositorySource, /const viewer = await getWalletViewer\(viewerId\);/);
  assert.match(repositorySource, /const clauses = viewer\.role === "admin" \? \[\] : \["c\.user_id = :viewerId"\];/);
  assert.match(repositorySource, /if \(viewer\.role === "admin" && userId && userId !== "all"\)/);
  assert.match(repositorySource, /c\.created_at >= :fromTime/);
  assert.match(repositorySource, /c\.created_at <= :toTime/);
  assert.match(repositorySource, /JOIN users u ON u\.id = c\.user_id/);
});
