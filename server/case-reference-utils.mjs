export function buildCaseReferenceGroups({ categories = [], cases = [] } = {}) {
  const groupMap = new Map();
  for (const category of categories) {
    groupMap.set(String(category.id), {
      id: category.id,
      name: category.name,
      cases: [],
    });
  }

  for (const item of cases) {
    const categoryId = String(item.categoryId || "");
    if (!groupMap.has(categoryId)) {
      groupMap.set(categoryId, {
        id: item.categoryId || categoryId,
        name: item.categoryName || "未分类",
        cases: [],
      });
    }
    groupMap.get(categoryId).cases.push({
      id: item.id,
      caseNumber: item.caseNumber,
      title: item.title,
      image: item.image,
      prompt: item.prompt,
      useCount: Number(item.useCount || 0),
    });
  }

  for (const group of groupMap.values()) {
    group.cases.sort((a, b) => (
      Number(b.useCount || 0) - Number(a.useCount || 0) ||
      Number(b.caseNumber || 0) - Number(a.caseNumber || 0) ||
      Number(b.id || 0) - Number(a.id || 0)
    ));
  }

  return Array.from(groupMap.values()).filter((group) => group.cases.length);
}
