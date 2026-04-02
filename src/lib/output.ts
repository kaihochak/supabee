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
  } catch (error: unknown) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') return false;
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

async function collectFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];
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

async function restoreKeepFiles({
  outputDir,
  sourceDir,
  keepFiles,
  label,
  silent = false,
}: {
  outputDir: string;
  sourceDir: string | null;
  keepFiles: string[];
  label: string;
  silent?: boolean;
}) {
  if (!sourceDir || !Array.isArray(keepFiles) || keepFiles.length === 0) return 0;
  const existingFiles = await collectFiles(sourceDir);
  const restoreTargets = existingFiles.filter((relativePath) =>
    keepFiles.some((pattern) => matchesKeepPattern(relativePath, pattern)),
  );

  for (const relativePath of restoreTargets) {
    const from = path.join(sourceDir, relativePath);
    const to = path.join(outputDir, relativePath);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
  }

  if (!silent && restoreTargets.length > 0) {
    console.log(info(`Restored ${restoreTargets.length} kept file(s) for ${label.toLowerCase()} output.`));
  }
  return restoreTargets.length;
}

async function clearOutputDirWithoutBackup({
  outputDir,
  keepFiles,
  label,
}: {
  outputDir: string;
  keepFiles: string[];
  label: string;
}) {
  if (!Array.isArray(keepFiles) || keepFiles.length === 0) {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    await fs.promises.mkdir(outputDir, { recursive: true });
    console.log(info(`Cleared existing ${label.toLowerCase()} output without backup.`));
    return { restoredCount: 0 };
  }

  const preserveDir = path.join(path.dirname(outputDir), `.preserve_${path.basename(outputDir)}_${timestampForPath()}`);
  await fs.promises.mkdir(preserveDir, { recursive: true });
  await restoreKeepFiles({
    outputDir: preserveDir,
    sourceDir: outputDir,
    keepFiles,
    label,
    silent: true,
  });

  await fs.promises.rm(outputDir, { recursive: true, force: true });
  await fs.promises.mkdir(outputDir, { recursive: true });
  const restoredCount = await restoreKeepFiles({
    outputDir,
    sourceDir: preserveDir,
    keepFiles,
    label,
  });
  await fs.promises.rm(preserveDir, { recursive: true, force: true });
  console.log(info(`Cleared existing ${label.toLowerCase()} output without backup.`));
  return { restoredCount };
}

export async function prepareSplitOutputDir(
  outputDir: string,
  backup: boolean,
  label: string,
  options: { keepFiles?: string[] } = {},
) {
  const { keepFiles = [] } = options;
  const isDirty = await hasAnyFiles(outputDir);
  if (!isDirty) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    return { backupPath: null, restoredCount: 0 };
  }

  if (!backup) {
    const { restoredCount } = await clearOutputDirWithoutBackup({ outputDir, keepFiles, label });
    return { backupPath: null, restoredCount };
  }

  const backupRoot = path.join(path.dirname(outputDir), 'backup');
  const backupPath = path.join(backupRoot, `${path.basename(outputDir)}_${timestampForPath()}`);
  await fs.promises.mkdir(backupRoot, { recursive: true });
  await fs.promises.rename(outputDir, backupPath);
  await fs.promises.mkdir(outputDir, { recursive: true });
  console.log(info(`Backed up existing ${label.toLowerCase()} output to: ${backupPath}`));
  const restoredCount = await restoreKeepFiles({ outputDir, sourceDir: backupPath, keepFiles, label });
  return { backupPath, restoredCount };
}
