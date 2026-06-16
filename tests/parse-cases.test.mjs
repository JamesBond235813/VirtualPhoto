import assert from "node:assert/strict";
import test from "node:test";

import { parseCaseMarkdown } from "../scripts/build-gallery-data.mjs";

test("parses case title, source, image, and prompt from Chinese case markdown", () => {
  const markdown = `# Demo

### Case 151: [E-commerce Main Image](https://x.com/source/status/1) (by [@maker](https://x.com/maker))

| 输出效果 |
| :----: |
| <a href="https://example.com"><img src="https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/poster_case151/output.jpg" width="300" alt="输出图像"></a> |

**提示词：**

\`\`\`
A clean product photo.
\`\`\`
`;

  const cases = parseCaseMarkdown(markdown, {
    categoryId: "ecommerce",
    categoryName: "电商",
    sourceFile: "cases/ecommerce_zh-CN.md",
  });

  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0], {
    id: "ecommerce-151",
    caseNumber: 151,
    title: "E-commerce Main Image",
    author: "@maker",
    sourceUrl: "https://x.com/source/status/1",
    categoryId: "ecommerce",
    categoryName: "电商",
    image: "images/poster_case151/output.jpg",
    prompt: "A clean product photo.",
    sourceFile: "cases/ecommerce_zh-CN.md",
  });
});
