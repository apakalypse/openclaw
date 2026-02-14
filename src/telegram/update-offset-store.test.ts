import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashTelegramToken,
  readTelegramUpdateOffsetState,
  writeTelegramUpdateOffset,
} from "./update-offset-store.js";

describe("telegram update offset store", () => {
  it("reads legacy v1 state and writes v2 with tokenHash", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-offset-"));
    const env = { ...process.env, OPENCLAW_STATE_DIR: tmp };
    const dir = path.join(tmp, "telegram");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const legacyPath = path.join(dir, "update-offset-default.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ version: 1, lastUpdateId: 123 }, null, 2) + "\n",
      "utf8",
    );

    const legacy = await readTelegramUpdateOffsetState({ env });
    expect(legacy?.lastUpdateId).toBe(123);
    expect(legacy?.tokenHash ?? null).toBe(null);

    const tokenHash = hashTelegramToken("123:abc");
    await writeTelegramUpdateOffset({ env, updateId: 456, tokenHash });

    const next = await readTelegramUpdateOffsetState({ env });
    expect(next?.lastUpdateId).toBe(456);
    expect(next?.tokenHash).toBe(tokenHash);
  });
});
