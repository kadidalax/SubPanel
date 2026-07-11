import test from "node:test";
import assert from "node:assert/strict";
import { detectClient } from "../src/services/client_detect.ts";

test("detect flclash and karing and nekobox", () => {
  assert.equal(detectClient("FlClash/1.0").format, "mihomo");
  assert.equal(detectClient("karing/1.0").format, "singbox");
  assert.equal(detectClient("NekoBox/1.0").format, "uri");
  assert.equal(detectClient("surge iOS").format, "surge");
  assert.equal(detectClient("Stash/2.0").format, "mihomo");
  assert.equal(detectClient("ClashX Meta").format, "mihomo");
  assert.equal(detectClient("Shadowrocket/1").format, "uri");
  assert.equal(detectClient("Quantumult%20X").format, "uri");
});

test("traffic threshold math", () => {
  const used = 80;
  const limit = 100;
  const pct = Math.floor((used / limit) * 100);
  assert.equal(pct, 80);
  assert.ok(pct >= 80);
});


// local pure helpers mirrored from settings parsing
function parseExpireRemindDays(v: unknown, fallback: number[] = [7, 3, 1]): number[] {
  if (v == null) return fallback;
  if (Array.isArray(v)) {
    const days = v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    return days.length ? days : fallback;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return [v];
  const days = String(v)
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return days.length ? days : fallback;
}

test("expire remind days parse csv and array", () => {
  assert.deepEqual(parseExpireRemindDays("7,3,1"), [7, 3, 1]);
  assert.deepEqual(parseExpireRemindDays([5, 1]), [5, 1]);
  assert.deepEqual(parseExpireRemindDays("bad"), [7, 3, 1]);
});

test("manual userinfo string shape", () => {
  const used = 123;
  const total = 1000;
  const expire = 1700000000;
  const header = `upload=0; download=${used}; total=${total}; expire=${expire}`;
  assert.match(header, /upload=0; download=123; total=1000; expire=1700000000/);
});
