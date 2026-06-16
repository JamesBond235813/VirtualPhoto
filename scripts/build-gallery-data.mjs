import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const categories = [
  { id: "ecommerce", name: "电商产品", file: "cases/ecommerce_zh-CN.md" },
  { id: "ad-creative", name: "广告创意", file: "cases/ad-creative_zh-CN.md" },
  { id: "portrait", name: "人像摄影", file: "cases/portrait_zh-CN.md" },
  { id: "poster", name: "海报插画", file: "cases/poster_zh-CN.md" },
  { id: "character", name: "角色设计", file: "cases/character_zh-CN.md" },
  { id: "ui", name: "UI/社媒", file: "cases/ui_zh-CN.md" },
  { id: "comparison", name: "对比案例", file: "cases/comparison_zh-CN.md" },
];

export function parseCaseMarkdown(markdown, category) {
  const caseHeading = /^### Case (\d+): \[([^\]]+)\]\(([^)]+)\)(?: \(by \[([^\]]+)\]\([^)]+\)\))?/gm;
  const cases = [];
  const matches = [...markdown.matchAll(caseHeading)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const block = markdown.slice(match.index, next?.index ?? markdown.length);
    const caseNumber = Number(match[1]);
    const imageMatch = block.match(/<img\s+src="([^"]+)"/i);
    const promptMatch = block.match(/\*\*(?:提示词|Prompt)：?\*\*\s*\n+\s*```(?:\w+)?\n([\s\S]*?)\n```/i);

    if (!promptMatch) {
      continue;
    }

    cases.push({
      id: `${category.categoryId}-${caseNumber}`,
      caseNumber,
      title: match[2].trim(),
      author: match[4]?.trim() ?? "",
      sourceUrl: match[3].trim(),
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      image: toLocalImagePath(imageMatch?.[1] ?? ""),
      prompt: promptMatch[1].trim(),
      sourceFile: category.sourceFile,
    });
  }

  return cases;
}

function toLocalImagePath(src) {
  const marker = "/main/";
  if (src.includes(marker)) {
    return src.slice(src.indexOf(marker) + marker.length);
  }
  return src;
}

export async function buildGalleryPayload() {
  const allCases = [];

  for (const category of categories) {
    const markdown = await readFile(path.join(rootDir, category.file), "utf8");
    allCases.push(
      ...parseCaseMarkdown(markdown, {
        categoryId: category.id,
        categoryName: category.name,
        sourceFile: category.file,
      }),
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    categories,
    cases: allCases.sort((a, b) => b.caseNumber - a.caseNumber),
  };

  const js = `window.GALLERY_DATA = ${JSON.stringify(payload, null, 2)};\n`;
  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const payload = await buildGalleryPayload();
  const js = `window.GALLERY_DATA = ${JSON.stringify(payload, null, 2)};\n`;
  await writeFile(path.join(rootDir, "gallery-data.js"), js);
  console.log(`Generated gallery-data.js with ${payload.cases.length} cases.`);
}
