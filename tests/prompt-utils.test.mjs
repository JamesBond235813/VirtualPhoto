import assert from "node:assert/strict";
import test from "node:test";

import { AUTHORIZATION_STATEMENT, withAuthorizationStatement } from "../server/prompt-utils.mjs";

test("prepends authorization statement once when enabled", () => {
  const prompt = "生成一张高端商务写真。";
  const result = withAuthorizationStatement(prompt, true);

  assert.ok(result.startsWith(AUTHORIZATION_STATEMENT));
  assert.equal(withAuthorizationStatement(result, true), result);
});

test("leaves prompt unchanged when authorization is not enabled", () => {
  assert.equal(withAuthorizationStatement("普通风景照", false), "普通风景照");
});
