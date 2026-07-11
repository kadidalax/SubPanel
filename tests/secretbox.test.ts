import test from "node:test";
import assert from "node:assert/strict";
import { decryptText, encryptText } from "../src/crypto/secretbox.ts";

test("encrypt decrypt roundtrip", async () => {
  const packed = await encryptText("test-key-material", "https://example.com/sub?token=abc");
  const plain = await decryptText("test-key-material", packed);
  assert.equal(plain, "https://example.com/sub?token=abc");
});
