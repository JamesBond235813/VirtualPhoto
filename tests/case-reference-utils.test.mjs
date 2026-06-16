import assert from "node:assert/strict";
import test from "node:test";

import { buildCaseReferenceGroups } from "../server/case-reference-utils.mjs";

test("groups case references by category with case number, title, image, and prompt", () => {
  const groups = buildCaseReferenceGroups({
    categories: [
      { id: "portrait", name: "写真", sortOrder: 1 },
      { id: "poster", name: "海报", sortOrder: 2 },
    ],
    cases: [
      { id: 2, categoryId: "poster", categoryName: "海报", caseNumber: 8, title: "产品海报", image: "poster.jpg", prompt: "poster prompt", useCount: 0 },
      { id: 1, categoryId: "portrait", categoryName: "写真", caseNumber: 3, title: "商务写真", image: "portrait.jpg", prompt: "portrait prompt", useCount: 0 },
    ],
  });

  assert.deepEqual(groups, [
    {
      id: "portrait",
      name: "写真",
      cases: [{ id: 1, caseNumber: 3, title: "商务写真", image: "portrait.jpg", prompt: "portrait prompt", useCount: 0 }],
    },
    {
      id: "poster",
      name: "海报",
      cases: [{ id: 2, caseNumber: 8, title: "产品海报", image: "poster.jpg", prompt: "poster prompt", useCount: 0 }],
    },
  ]);
});

test("sorts cases inside each reference category by usage count first", () => {
  const groups = buildCaseReferenceGroups({
    categories: [{ id: "portrait", name: "写真", sortOrder: 1 }],
    cases: [
      { id: 1, categoryId: "portrait", categoryName: "写真", caseNumber: 101, title: "低频案例", image: "low.jpg", prompt: "low", useCount: 2 },
      { id: 2, categoryId: "portrait", categoryName: "写真", caseNumber: 88, title: "高频案例", image: "high.jpg", prompt: "high", useCount: 9 },
      { id: 3, categoryId: "portrait", categoryName: "写真", caseNumber: 120, title: "未使用案例", image: "none.jpg", prompt: "none", useCount: 0 },
    ],
  });

  assert.deepEqual(
    groups[0].cases.map((item) => item.title),
    ["高频案例", "低频案例", "未使用案例"],
  );
});
