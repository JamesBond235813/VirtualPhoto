import assert from "node:assert/strict";
import test from "node:test";

test("uses xiaojiang as the default admin account and reads password from environment", async () => {
  const originalPassword = process.env.APP_ADMIN_PASSWORD;
  process.env.APP_ADMIN_PASSWORD = "change-me-admin-password";

  const { config } = await import(`../server/config.mjs?case=${Date.now()}`);

  assert.equal(config.admin.email, "xiaojiang");
  assert.equal(config.admin.password, "change-me-admin-password");

  if (originalPassword === undefined) {
    delete process.env.APP_ADMIN_PASSWORD;
  } else {
    process.env.APP_ADMIN_PASSWORD = originalPassword;
  }
});
