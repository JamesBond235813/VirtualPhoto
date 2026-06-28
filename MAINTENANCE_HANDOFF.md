# AI照相馆维护交接文档

更新时间：2026-06-28

这份文档用于让新的维护者快速接手“AI照相馆”的本地开发、生产排障和发布同步工作。已有的 `LOCAL_APP_USAGE.md` 是本地启动说明；本文件补齐项目结构、关键链路、生产环境、排障入口和发布流程。

## 1. 当前状态

- 本地项目路径：`/Volumes/littlejiang02/小姜的AI照相馆`
- GitHub 仓库：`https://github.com/JamesBond235813/VirtualPhoto`
- 主分支：`main`
- 生产服务器 SSH：`tencent-superapi`
- 生产部署目录：`/data/servers/xiaojiang-ai-photo/current`
- systemd 服务：`xiaojiang-ai-photo.service`
- 生产服务端口：`4177`
- 服务用户：`xiaojiangai:xiaojiangai`
- 日志目录：`/data/servers/xiaojiang-ai-photo/logs`
- 技术栈：Node.js ESM、Express、MySQL、原生前端、OpenAI-compatible 图片接口、火山方舟视频接口。

## 2. 已有文档

- `LOCAL_APP_USAGE.md`：本地 MySQL、初始化、启动、基本使用流程。
- `README*.md`：原案例库/提示词资料，体量较大，不适合作为维护入口。
- `前端重构说明.md`：早期前端重构记录。
- `MAINTENANCE_HANDOFF.md`：当前维护交接入口，后续有架构、部署或排障变化时优先更新本文件。

## 3. 本地开发

安装依赖：

```bash
npm install
```

准备配置：

```bash
cp .env.example .env
```

初始化数据库和案例：

```bash
npm run db:init
```

启动：

```bash
npm run dev
```

本地访问：

```text
http://localhost:4177
```

常用验证：

```bash
npm test
```

## 4. 目录和关键文件

- `index.html`：主页面结构。
- `app.js`：前端状态、表单、创作、用户、供应商、支付、新闻等交互逻辑。
- `styles.css`：页面样式。
- `server/index.mjs`：Express 入口，注册所有 API、静态资源、定时 AI 产经更新。
- `server/config.mjs`：端口、MySQL、管理员账号配置。
- `server/repository.mjs`：数据库读写、用户、案例、供应商、模型价格、创作记录、视频任务、站点参数。
- `server/schema.mjs`：表结构。
- `server/openai-compatible.mjs`：图片生成兼容层。
- `server/volcengine-video.mjs`：火山方舟视频生成。
- `server/payments.mjs`：支付宝/微信支付配置、订单、回调、查单。
- `server/sms.mjs`：阿里云短信验证码。
- `server/ai-news.mjs`：AI 产经 RSS/Google News 聚合与摘要。
- `tests/*.test.mjs`：回归测试。
- `uploads/input`：上传临时输入。
- `uploads/generated`：生成图片落盘输出。

## 5. 核心功能链路

### 5.1 图片生成

入口：`POST /api/generate`

生成模式：

- `text`：文生图，不需要参考图，走 `/v1/images/generations`。
- `image`：文+图，最多 6 张参考图。
- `inpaint`：局部重绘，需要原图和蒙版。

关键实现：

- `server/index.mjs` 负责校验用户、余额、模型、上传文件。
- `server/openai-compatible.mjs` 负责调用供应商。
- 成功后写入 `creations`，并扣余额或核销单次支付订单。
- 失败后写入 `creations.status='failed'` 和 `error_message`，失败不扣余额；单次支付订单也不会被核销，用户可重试。

图片接口规则：

- 文生图：`/v1/images/generations`
- GPT Image / DALL-E 带图：只走 `/v1/images/edits`
- Gemini / flash-image / nano-banana / Seedream / SeedEdit 带图：优先走 `chat/completions` 多模态，失败后再尝试 `/v1/images/edits`
- 多张参考图的 multipart 字段名必须重复使用 `image`，不要改成 `image[]`
- `gpt-image-*` 不要回退到 chat/completions

常见失败判断：

- `HTTP 502 · upstream did not return image output`：供应商上游没有返回图片，通常不是余额问题。
- `生成接口没有返回图片` / `多模态接口未返回图片`：供应商返回成功响应但内容里没有 `url` 或 `b64_json`。
- `上游连接超时` / `UND_ERR_HEADERS_TIMEOUT`：模型响应过慢或供应商链路超时。
- `model ... is only supported on /v1/images/generations and /v1/images/edits`：该模型被错误送到 chat 通道。
- `failed to parse multipart form`：优先检查 multipart 字段名、文件名、MIME 和 `/v1/images/edits` 请求格式。

### 5.2 提示词反推

入口：`POST /api/derive-prompt`

配置：

- `DERIVE_MODEL`：视觉模型，默认 `gpt-4o-mini`。
- `TRANSLATE_MODEL`：翻译模型，默认 `gpt-4o-mini`。
- 价格优先读站点参数 `derivePriceYuan`，没有时读 `.env` 的 `DERIVE_PRICE_YUAN`，默认免费。

供应商凭据来自后台“供应商与定价”，不会从 `.env` 直接读图片供应商 key。

### 5.3 视频生成

入口：

- `POST /api/video/generate`
- `GET /api/video/tasks/:id?userId=...`

配置：

- `ARK_API_KEY` 或 `VOLCENGINE_API_KEY`
- `VOLCENGINE_BASE_URL`，默认 `https://ark.cn-beijing.volces.com/api/v3`
- `VOLCENGINE_VIDEO_MODEL`，默认 `doubao-seedance-2-0-260128`
- `VOLCENGINE_VIDEO_PRICE_YUAN`
- `VOLCENGINE_VIDEO_TIMEOUT_MS`
- `VOLCENGINE_VIDEO_POLL_MS`

模式：

- 文生视频
- 图生视频
- 视频生视频

成功后写入 `video_tasks`，轮询到成功后再写入 `creations` 并扣费。

### 5.4 支付和财务

入口：

- `/api/payments/config`
- `/api/payments/channels`
- `/api/payments/orders`
- `/api/payments/notify/alipay`
- `/api/payments/notify/wechat`
- `/api/finance/summary`

支付商户参数保存在数据库 `payment_configs.config_json`，不在 `.env`。敏感字段不会下发前端明文。

回调域名优先使用 `PUBLIC_BASE_URL`。如果未设置，则根据请求头生成。

### 5.5 用户、短信、案例和历史

- 用户：`users`
- 钱包流水：`wallet_transactions`
- 案例：`categories`、`prompt_cases`
- 案例使用排序：`case_usage_events`
- 创作历史：`creations`
- 注册短信：`sms_codes`

短信配置：

- `SMS_ACCESS_KEY_ID`
- `SMS_ACCESS_KEY_SECRET`
- `SMS_SIGN_NAME`
- `SMS_TEMPLATE_CODE`

未配置短信密钥时会进入本地联调模式，验证码只打印在服务端日志，不会真实发送。

### 5.6 AI 产经

入口：

- `GET /api/ai-news`
- `POST /api/ai-news/refresh`

数据表：

- `ai_news_items`
- `app_settings`

自动更新时间：

- 后台站点参数 `aiNewsRefreshTime`，默认 `09:00`，按北京时间计算。

摘要模型：

- `AI_NEWS_MODEL`
- 未设置时依次回退 `TRANSLATE_MODEL`、`DERIVE_MODEL`、`gpt-5.4`

新闻源来自 RSS 和 Google News RSS。网络不可达时会跳过失败源。

## 6. 生产环境

查看服务：

```bash
ssh tencent-superapi 'systemctl status xiaojiang-ai-photo.service --no-pager'
```

查看日志：

```bash
ssh tencent-superapi 'tail -n 200 /data/servers/xiaojiang-ai-photo/logs/app.err'
ssh tencent-superapi 'tail -n 200 /data/servers/xiaojiang-ai-photo/logs/app.log'
```

健康检查：

```bash
ssh tencent-superapi 'curl -fsS http://127.0.0.1:4177/api/health'
ssh tencent-superapi 'curl -fsS -I http://127.0.0.1:4177/ | head -n 5'
```

重启服务：

```bash
ssh tencent-superapi 'systemctl restart xiaojiang-ai-photo.service && sleep 2 && systemctl is-active xiaojiang-ai-photo.service'
```

重要权限：

```bash
ssh tencent-superapi 'chown -R xiaojiangai:xiaojiangai /data/servers/xiaojiang-ai-photo/current /data/servers/xiaojiang-ai-photo/logs'
ssh tencent-superapi 'find /data/servers/xiaojiang-ai-photo/current -type d -exec chmod 755 {} \;'
ssh tencent-superapi 'find /data/servers/xiaojiang-ai-photo/current -type f -exec chmod 644 {} \;'
ssh tencent-superapi 'chmod 755 /data/servers/xiaojiang-ai-photo/current/uploads /data/servers/xiaojiang-ai-photo/current/uploads/input /data/servers/xiaojiang-ai-photo/current/uploads/generated'
```

历史故障：`index.html`、`app.js`、`server/`、`tests/` 或日志文件被写成 `root:root` 且权限过紧，会导致页面或日志异常。部署后务必修正所有权。

## 7. 发布和同步流程

发布目标：本地、GitHub、腾讯云代码一致。

推荐顺序：

1. 本地修改代码和文档。
2. 运行 `npm test`。
3. 提交并推送 GitHub。
4. 同步代码到腾讯云。
5. 修正线上权限。
6. 在线上运行关键测试。
7. 重启服务并做健康检查。
8. 用 `rsync --dry-run --checksum` 确认本地和云端代码无差异。

同步命令示例。只同步 Git 跟踪文件，避免把本地临时文件、`.DS_Store` 或密钥带上生产：

```bash
git ls-files -z | rsync -az --from0 --files-from=- ./ tencent-superapi:/data/servers/xiaojiang-ai-photo/current/
```

线上验证：

```bash
ssh tencent-superapi 'cd /data/servers/xiaojiang-ai-photo/current && npm test'
ssh tencent-superapi 'systemctl restart xiaojiang-ai-photo.service && sleep 2 && systemctl is-active xiaojiang-ai-photo.service'
ssh tencent-superapi 'curl -fsS http://127.0.0.1:4177/api/health'
```

一致性检查：

```bash
git ls-files -z | rsync -aznci --from0 --files-from=- ./ tencent-superapi:/data/servers/xiaojiang-ai-photo/current/
```

如果上面的 dry-run 没有输出代码文件差异，说明 Git 跟踪代码在本地和云端一致。线上允许额外存在 `.env`、`node_modules/`、`uploads/` 等运行时文件。

## 8. 数据库排障常用查询

最近失败创作：

```sql
SELECT c.id, c.user_id, u.email, p.name AS provider_name, c.model,
       c.charge_cents, c.status, c.error_message, c.created_at
FROM creations c
LEFT JOIN users u ON u.id = c.user_id
LEFT JOIN providers p ON p.id = c.provider_id
WHERE c.status = 'failed'
ORDER BY c.id DESC
LIMIT 20;
```

确认失败是否扣费：

```sql
SELECT id, type, amount_cents, note, created_at
FROM wallet_transactions
WHERE created_at BETWEEN '开始时间' AND '结束时间'
ORDER BY id;
```

查看供应商和模型启用状态：

```sql
SELECT p.id AS provider_id, p.name, p.enabled AS provider_enabled,
       mp.id AS price_id, mp.model, mp.display_name, mp.unit_price_cents, mp.enabled AS model_enabled
FROM providers p
LEFT JOIN model_prices mp ON mp.provider_id = p.id
ORDER BY p.id, mp.id;
```

不要在文档、聊天、提交信息里记录 API key、商户私钥、短信密钥、真实手机号或完整用户提示词。

## 9. 回归测试重点

关键测试文件：

- `tests/openai-compatible.test.mjs`
- `tests/frontend-regression.test.mjs`
- `tests/volcengine-video.test.mjs`
- `tests/payment.test.mjs`
- `tests/ai-news.test.mjs`

图片接口改动必须覆盖：

- 文生图走 `/v1/images/generations`
- 单图/多图编辑走 `/v1/images/edits`
- 多图字段名重复 `image`
- `gpt-image-*` 不回退 chat
- mask 同时包含 `image` 和 `mask`

前端 UI 改动必须跑全量 `npm test`，因为很多页面结构和交互依赖静态回归测试。

## 10. 维护原则

- 先看 `creations.error_message` 和 `/data/servers/xiaojiang-ai-photo/logs/app.err`，不要凭现象猜。
- 失败记录不等于扣费，扣费以 `wallet_transactions` 为准。
- 供应商连通性要分清：base url/key 可用、模型启用、端点支持、上游是否返回图片，是四件事。
- 生产配置以数据库和 `.env` 为准，GitHub 只保存代码和模板。
- 每次同步云端后都要修正 `xiaojiangai:xiaojiangai` 所有权。
- 不要把 `.env`、上传文件、生成文件、`node_modules` 推到 GitHub。
