import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, needsRehash, verifyPassword } from "../src/crypto/password.ts";

test("hash and verify password", async () => {
  const encoded = await hashPassword("correct-horse-battery", 10000);
  assert.equal(await verifyPassword("correct-horse-battery", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  assert.equal(needsRehash(encoded, 10000), false);
  assert.equal(needsRehash(encoded, 20000), true);
});
