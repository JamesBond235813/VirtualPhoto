export function calculateGenerationCharge({ unitPriceCents, quantity = 1 }) {
  const price = Number(unitPriceCents);
  const count = Number(quantity);

  if (!Number.isInteger(price) || price < 0) {
    throw new Error("模型价格必须是非负整数分");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("生成数量必须是正整数");
  }

  return price * count;
}

export function ensureSufficientBalance({ balanceCents, chargeCents }) {
  if (Number(balanceCents) < Number(chargeCents)) {
    throw new Error("余额不足，请先充值");
  }
}
