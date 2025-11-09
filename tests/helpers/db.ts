import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { __resetDbForTests } from "../../src/lib/db";

const ORIGINAL_CWD = process.cwd();

export function useTestDatabase() {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rit-api-test-"));
    process.chdir(tempDir);
    __resetDbForTests();
  });

  afterEach(() => {
    __resetDbForTests();
    process.chdir(ORIGINAL_CWD);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}
