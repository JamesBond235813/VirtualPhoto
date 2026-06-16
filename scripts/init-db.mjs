import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

import { buildGalleryPayload } from "./build-gallery-data.mjs";
import { config } from "../server/config.mjs";
import { schemaStatements } from "../server/schema.mjs";

async function main() {
  const serverConnection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
  });
  await serverConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await serverConnection.end();

  const connection = await mysql.createConnection(config.mysql);
  for (const statement of schemaStatements) {
    await connection.query(statement);
  }

  const payload = await buildGalleryPayload();

  for (const [index, category] of payload.categories.entries()) {
    await connection.execute(
      `INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order)`,
      [category.id, category.name, index],
    );
  }

  for (const item of payload.cases) {
    await connection.execute(
      `INSERT INTO prompt_cases (case_number, category_id, title, author, source_url, image_path, prompt, source_file)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
        SELECT 1 FROM prompt_cases WHERE case_number = ? AND category_id = ? AND title = ?
       )`,
      [
        item.caseNumber,
        item.categoryId,
        item.title,
        item.author,
        item.sourceUrl,
        item.image,
        item.prompt,
        item.sourceFile,
        item.caseNumber,
        item.categoryId,
        item.title,
      ],
    );
  }

  const passwordHash = await bcrypt.hash(config.admin.password, 10);
  await connection.execute(
    `INSERT INTO users (email, name, password_hash, role, balance_cents)
     VALUES (?, '管理员', ?, 'admin', 100000)
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = 'admin'`,
    [config.admin.email, passwordHash],
  );

  const [[providerCount]] = await connection.query("SELECT COUNT(*) AS count FROM providers");
  if (Number(providerCount.count) === 0) {
    const [providerResult] = await connection.execute(
      `INSERT INTO providers (name, base_url, api_key, default_model, enabled)
       VALUES ('OpenAI Compatible', 'https://api.openai.com', 'replace-with-your-key', 'gpt-image-1', 0)`,
    );
    await connection.execute(
      `INSERT INTO model_prices (provider_id, model, display_name, unit_price_cents, enabled)
       VALUES (?, 'gpt-image-1', 'GPT Image', 300, 0)`,
      [providerResult.insertId],
    );
  }

  const [[caseCount]] = await connection.query("SELECT COUNT(*) AS count FROM prompt_cases");
  await connection.end();
  console.log(`Database ready: ${config.mysql.database}, cases: ${caseCount.count}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
