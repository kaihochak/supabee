// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { info } from './ui.js';

function timestampForPath() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function hasAnyFiles(dirPath) {
  try {
    const entries = await fs.promises.readdir(dirPath);
    return entries.length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function toRegexPattern(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesKeepPattern(relativePath, pattern) {
  const baseName = path.basename(relativePath);
  if (pattern.includes('*')) {
    const regex = toRegexPattern(pattern);
    return regex.test(relativePath) || regex.test(baseName);
  }
  if (pattern.includes('/')) return relativePath === pattern;
  return baseName === pattern;
}

async function collectFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, absolutePath)));
      continue;
    }
    if (entry.isFile()) files.push(path.relative(rootDir, absolutePath));
  }
  return files;
}

async function restoreKeepFiles({ outputDir, backupPath, keepFiles, label }) {
  if (!backupPath || !Array.isArray(keepFiles) || keepFiles.length === 0) return 0;
  const existingFiles = await collectFiles(backupPath);
  const restoreTargets = existingFiles.filter((relativePath) =>
    keepFiles.some((pattern) => matchesKeepPattern(relativePath, pattern)),
  );

  for (const relativePath of restoreTargets) {
    const from = path.join(backupPath, relativePath);
    const to = path.join(outputDir, relativePath);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
  }

  if (restoreTargets.length > 0) {
    console.log(info(`Restored ${restoreTargets.length} kept file(s) for ${label.toLowerCase()} output.`));
  }
  return restoreTargets.length;
}

export async function prepareSplitOutputDir(outputDir, backup, label, options = {}) {
  const { keepFiles = [] } = options;
  const isDirty = await hasAnyFiles(outputDir);
  if (!isDirty) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    return { backupPath: null, restoredCount: 0 };
  }

  if (!backup) {
    throw new Error(
      `${label} output directory is not empty: ${outputDir}.\nRe-run with --backup to preserve existing files.`,
    );
  }

  const backupRoot = path.join(path.dirname(outputDir), 'backup');
  const backupPath = path.join(backupRoot, `${path.basename(outputDir)}_${timestampForPath()}`);
  await fs.promises.mkdir(backupRoot, { recursive: true });
  await fs.promises.rename(outputDir, backupPath);
  await fs.promises.mkdir(outputDir, { recursive: true });
  console.log(info(`Backed up existing ${label.toLowerCase()} output to: ${backupPath}`));
  const restoredCount = await restoreKeepFiles({ outputDir, backupPath, keepFiles, label });
  return { backupPath, restoredCount };
}
