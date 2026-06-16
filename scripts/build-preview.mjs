/**
 * 从 index.html 自动生成 preview.html（免数据库设计预览页）
 * 用法：node scripts/build-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mock = fs.readFileSync(path.join(root, "scripts/preview-mock.html"), "utf8").trimEnd();

const banner = `<!--
  preview.html · 设计预览页（无需 MySQL / 后端）— 由 scripts/build-preview.mjs 自动生成，请勿手改
  所有数据为本地模拟（gallery-data.js + scripts/preview-mock.html），写操作不会落库。
  真实使用请运行 npm run dev 并访问 http://localhost:4177
-->\n`;

html = html.replace(/<title>[^<]*<\/title>/, "<title>AI 照相馆 · 设计预览（模拟数据）</title>");
html = html.replace(/(\s*)<script src="app\.js[^"]*"><\/script>/, `\n    ${mock.split("\n").join("\n")}\n$&`);
html = html.replace("<!doctype html>", "<!doctype html>\n" + banner);

fs.writeFileSync(path.join(root, "preview.html"), html);
console.log("preview.html 已生成:", html.length, "bytes");
