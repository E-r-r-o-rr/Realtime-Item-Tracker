import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(fullPath)));
    } else if (
      entry.isFile() &&
      fullPath.endsWith('.ts') &&
      !fullPath.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = await collectTestFiles(testsDir);

if (testFiles.length === 0) {
  console.error('No test files found under tests/.');
  process.exit(1);
}

const loaderPath = path.join(testsDir, 'ts-loader.mjs');
const loaderSpecifier = pathToFileURL(loaderPath).href;
const registerSource = [
  'import { register } from "node:module";',
  'import { pathToFileURL } from "node:url";',
  `register(${JSON.stringify(loaderSpecifier)}, pathToFileURL("./"));`,
].join(' ');
const registerDataUrl = `data:text/javascript,${encodeURIComponent(registerSource)}`;

const sanitizedEnv = { ...process.env };
delete sanitizedEnv.API_KEY;
if (!sanitizedEnv.NODE_ENV) {
  sanitizedEnv.NODE_ENV = 'test';
}

const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', '--import', registerDataUrl, ...testFiles],
  {
    stdio: 'inherit',
    cwd: projectRoot,
    env: sanitizedEnv,
    windowsHide: true,
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
