import assert from "node:assert/strict";
import test from "node:test";

import { calculateGenerationCharge, ensureSufficientBalance } from "../server/billing.mjs";

test("calculates a single generation charge from model unit price", () => {
  assert.equal(calculateGenerationCharge({ unitPriceCents: 299, quantity: 1 }), 299);
  assert.equal(calculateGenerationCharge({ unitPriceCents: 299, quantity: 3 }), 897);
});

test("rejects generation when balance is not enough", () => {
  assert.throws(
    () => ensureSufficientBalance({ balanceCents: 120, chargeCents: 299 }),
    /余额不足/,
  );
});
