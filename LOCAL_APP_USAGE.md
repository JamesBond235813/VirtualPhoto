# AI照相馆本地使用说明

## 1. 配置 MySQL

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`，填入你的本地 MySQL 信息：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=你的用户名
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=design_prompt_gallery
```

## 2. 初始化数据库

```bash
npm run db:init
```

脚本会创建数据库和表，并把当前中文案例导入 `prompt_cases`。

默认超管：

- 账号：`xiaojiang`
- 密码：见本地 `.env` 的 `APP_ADMIN_PASSWORD`
- 初始余额：`¥1000.00`

可在 `.env` 里用 `APP_ADMIN_EMAIL` 和 `APP_ADMIN_PASSWORD` 改掉。

## 3. 启动应用

```bash
npm run dev
```

打开：

```text
http://localhost:4177
```

## 4. 使用流程

1. 登录管理员账号。
2. 在“案例库”查看、搜索、新增、编辑、删除案例。
3. 在“供应商与定价”配置 OpenAI 兼容供应商：
   - `Base URL` 可填 `https://api.openai.com`，也可填兼容服务的 `/v1` 地址。
   - 接入本地用户服务时可填 `http://localhost:3000` 或 `http://localhost:3000/v1`。
   - `API Key` 会存入本地 MySQL。
   - 推荐使用用户服务里 `image_gen` 分组创建的 Key，确保该分组已绑定生图渠道。
   - 模型定价按“单次生成价格”扣费。
   - 可点击“解析模型和价格”自动读取 `/v1/models`；模型列表通常可读，价格只有在供应商返回价格元数据时才会自动填入，否则显示 `¥0.00`，需要手动确认。
4. 在“用户与充值”创建用户并充值。
5. 在“创作画布”输入 Prompt 或从案例库带入 Prompt，选择模型和生成模式后生成图片。
   - `文生图`：只发送 Prompt，调用 OpenAI 兼容 `/v1/images/generations`。
   - `文+图`：上传参考图并发送 Prompt，调用 `/v1/images/edits`。
   - `局部重绘`：上传原图，在画布上涂抹需要重绘的区域，系统会生成蒙版并调用 `/v1/images/edits`。
6. 在“历史记录”查看消费流水和创作记录。

## 5. 当前边界

- 第一版是本地 MVP，没有接真实支付，充值由管理员手动录入。
- 用户登录是轻量本地方案，适合本机内测，不适合直接暴露公网。
- 图片生成接口按 OpenAI 兼容协议调用；文生图走 `/v1/images/generations`，带参考图或蒙版走 `/v1/images/edits`。
