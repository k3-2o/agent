// P1 · CLI parse boundary — validate once at startup, usage errors, flag
// constraints. Frozen-red until `warden/warden.ts` exists.
import { test, expect } from "bun:test";
import { join } from "node:path";
import { createWarden, WardenUsageError } from "../warden";
import { fakeServerPath, tmpdir, rmdir, withEnv } from "./harness/util";

const tail = ["--", "bun", fakeServerPath];

async function expectUsage(argv: string[]): Promise<void> {
  const err: unknown = await createWarden(argv).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected WardenUsageError for ${JSON.stringify(argv)}`).toBeInstanceOf(WardenUsageError);
  if (err instanceof WardenUsageError) {
    expect(err.message.startsWith("usage:")).toBe(true);
  }
}

test("X1 unknown flag is a usage error", async () => {
  await expectUsage(["--bogus", ...tail]);
});

test("X2 non-numeric flag value is a usage error", async () => {
  await expectUsage(["--budget-mb", "abc", ...tail]);
});

test("X3 negative flag value is a usage error", async () => {
  await expectUsage(["--idle-secs", "-5", ...tail]);
});

test("X4 missing -- tail (no child command) is a usage error", async () => {
  await expectUsage(["--idle-secs", "5"]);
});

test("X5 valid zeros resolve fine", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const w = await createWarden(["--sleep-after", "0", "--budget-mb", "0", ...tail]);
      await w.dispose();
    });
  } finally {
    rmdir(dir);
  }
});

test("X6 numeric constraints: sustain/max-inflight/sample-secs must be >= 1", async () => {
  await expectUsage(["--sustain", "0", ...tail]);
  await expectUsage(["--max-inflight", "0", ...tail]);
  await expectUsage(["--sample-secs", "0", ...tail]);
});