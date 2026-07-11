import { createUser } from "../src/db/users.ts";
import { hashPassword } from "../src/crypto/password.ts";
import { nowMs } from "../src/util/time.ts";

// Minimal helper for local bootstrap without full wrangler binding automation.
// Prefer UI bootstrap-admin or POST /api/auth/bootstrap-admin in real use.

const username = process.argv[2] || "admin";
const password = process.argv[3] || "change-me-now";
if (password.length < 10) {
  console.error("password must be >= 10 chars");
  process.exit(1);
}
console.log(JSON.stringify({
  note: "Use web bootstrap or API. This script only validates password hashing locally.",
  username,
  passwordHash: await hashPassword(password, 210000),
  now: nowMs(),
}, null, 2));
