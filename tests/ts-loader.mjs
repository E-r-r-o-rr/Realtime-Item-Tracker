import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import typescript from "typescript";

const ts = typescript.default ?? typescript;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveWithExtensions(resolvedPath, query) {
  for (const ext of EXTENSIONS) {
    const candidate = resolvedPath + ext;
    if (await fileExists(candidate)) {
      const url = pathToFileURL(candidate).href;
      return query ? `${url}?${query}` : url;
    }
  }
  return null;
}

function getParentPath(parentURL) {
  if (!parentURL) return process.cwd();
  const parentPath = fileURLToPath(parentURL);
  if (parentPath.endsWith(path.sep)) {
    return parentPath;
  }
  return path.dirname(parentPath);
}

export async function resolve(specifier, context, defaultResolve) {
  const [withoutQuery, query] = specifier.split("?");

  if (withoutQuery === "next/headers") {
    const stubPath = path.resolve(process.cwd(), "tests/stubs/next-headers.ts");
    const url = pathToFileURL(stubPath).href;
    return { url: query ? `${url}?${query}` : url, shortCircuit: true };
  }

  if (withoutQuery === "next/server") {
    const stubPath = path.resolve(process.cwd(), "tests/stubs/next-server.ts");
    const url = pathToFileURL(stubPath).href;
    return { url: query ? `${url}?${query}` : url, shortCircuit: true };
  }

  if (withoutQuery.startsWith("@/")) {
    const relativePath = withoutQuery.slice(2);
    const resolvedPath = path.resolve(process.cwd(), "src", relativePath);
    const found = await resolveWithExtensions(resolvedPath, query);
    if (found) {
      return { url: found, shortCircuit: true };
    }
  }

  if (withoutQuery.startsWith("./") || withoutQuery.startsWith("../")) {
    const parentPath = getParentPath(context.parentURL);
    const resolvedPath = path.resolve(parentPath, withoutQuery);
    const found = await resolveWithExtensions(resolvedPath, query);
    if (found) {
      return { url: found, shortCircuit: true };
    }
  }

  if (withoutQuery.startsWith("/")) {
    const resolvedPath = path.resolve(process.cwd(), withoutQuery.slice(1));
    const found = await resolveWithExtensions(resolvedPath, query);
    if (found) {
      return { url: found, shortCircuit: true };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  const [cleanUrl] = url.split("?");
  if (cleanUrl.endsWith(".ts") || cleanUrl.endsWith(".tsx")) {
    const source = await ts.sys.readFile(fileURLToPath(cleanUrl), "utf8");
    if (source == null) {
      throw new Error(`Unable to read source for ${cleanUrl}`);
    }
    const transformed = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        resolveJsonModule: true,
        isolatedModules: false,
      },
      fileName: fileURLToPath(cleanUrl),
    });
    return {
      format: "module",
      source: transformed.outputText,
      shortCircuit: true,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}
