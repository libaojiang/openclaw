// npm staging helpers for the staged package directory install transaction.
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord as isObjectRecord } from "@openclaw/normalization-core/record-coerce";
import { hasErrnoCode } from "./errno.js";
import { tryReadJson, writeJson } from "./json-files.js";

const STAGED_NPM_PROJECT_CONFIG_NAME = ".npmrc";
const STAGED_NPM_PROJECT_CONFIG_PREFIX = ".openclaw-install-hidden-npmrc-";

type HiddenProjectConfigFile = {
  hiddenDir: string;
  originalPath: string;
  hiddenPath: string;
} | null;

export async function sanitizeManifestForNpmInstall(
  targetDir: string,
  omitOpenClawHostDependency: boolean,
): Promise<() => Promise<void>> {
  const manifestPath = path.join(targetDir, "package.json");
  const parsed = await tryReadJson<unknown>(manifestPath);
  if (!isObjectRecord(parsed)) {
    return () => Promise.resolve();
  }
  const manifest = parsed;
  const originalManifest = await fs.readFile(manifestPath);
  let changed = false;

  // npm resolves omitted development dependencies even when it does not install them.
  if (Object.hasOwn(manifest, "devDependencies")) {
    delete manifest.devDependencies;
    changed = true;
  }

  if (omitOpenClawHostDependency) {
    for (const key of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
    ] as const) {
      const dependencies = manifest[key];
      if (!isObjectRecord(dependencies) || !Object.hasOwn(dependencies, "openclaw")) {
        continue;
      }
      delete dependencies.openclaw;
      if (Object.keys(dependencies).length === 0) {
        delete manifest[key];
      }
      changed = true;
    }
  }

  if (changed) {
    await writeJson(manifestPath, manifest, { trailingNewline: true });
    return async () => {
      await fs.writeFile(manifestPath, originalManifest);
    };
  }
  return () => Promise.resolve();
}

export async function hideProjectNpmConfigForInstall(
  targetDir: string,
): Promise<HiddenProjectConfigFile> {
  const originalPath = path.join(targetDir, STAGED_NPM_PROJECT_CONFIG_NAME);
  let hiddenDir = "";
  try {
    hiddenDir = await fs.mkdtemp(path.join(targetDir, STAGED_NPM_PROJECT_CONFIG_PREFIX));
    const hiddenPath = path.join(hiddenDir, STAGED_NPM_PROJECT_CONFIG_NAME);
    await fs.rename(originalPath, hiddenPath);
    return { hiddenDir, originalPath, hiddenPath };
  } catch (error) {
    if (hiddenDir) {
      await fs.rm(hiddenDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (hasErrnoCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function restoreProjectNpmConfigAfterInstall(
  hiddenConfig: HiddenProjectConfigFile,
): Promise<void> {
  if (!hiddenConfig) {
    return;
  }
  await fs.rename(hiddenConfig.hiddenPath, hiddenConfig.originalPath);
  await fs.rm(hiddenConfig.hiddenDir, { recursive: true, force: true });
}
