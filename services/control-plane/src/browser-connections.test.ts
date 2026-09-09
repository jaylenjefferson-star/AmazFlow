import test from "node:test";
import assert from "node:assert/strict";
import { validateBrowserConnectionInput } from "./browser-connections";

test("browser connections default to their public HTTPS origin", () => {
  const value = validateBrowserConnectionInput({ name: "Portal", baseUrl: "https://portal.example.com/login" });
  assert.deepEqual(value.allowedOrigins, ["https://portal.example.com"]);
  assert.equal(value.preferredMode, "auto");
});

test("browser connections reject private destinations and broadened origins", () => {
  assert.throws(() => validateBrowserConnectionInput({ name: "Metadata", baseUrl: "https://169.254.169.254/latest" }), /public HTTPS/);
  assert.throws(() => validateBrowserConnectionInput({ name: "Local", baseUrl: "https://admin.local" }), /public HTTPS/);
  assert.throws(() => validateBrowserConnectionInput({ name: "Portal", baseUrl: "https://portal.example.com", allowedOrigins: ["https://other.example.com"] }), /include the base URL origin/);
  assert.throws(() => validateBrowserConnectionInput({ name: "Portal", baseUrl: "https://portal.example.com", allowedOrigins: ["https://portal.example.com/path"] }), /without a path/);
});
