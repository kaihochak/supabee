import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'site', 'src');
const tokenFile = path.join(sourceRoot, 'styles', 'global.css');
const sourceExtensions = new Set([
  '.astro',
  '.html',
  '.js',
  '.jsx',
  '.md',
  '.mdx',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

const rawUtilityPattern = /(?<![\w-])((?:[\w-]+:)*(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]\s"'`]+\])|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]\s"'`]+\])|leading-(?:none|tight|snug|normal|relaxed|loose|\[[^\]\s"'`]+\])|tracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]\s"'`]+\])))(?![\w-])/g;
const typographyDeclarationPattern = /\b(font-size|font-weight|line-height|letter-spacing)\s*:\s*([^;}]+)/g;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    else if (sourceExtensions.has(path.extname(entry.name)) || entry.name.endsWith('.css')) files.push(entryPath);
  }

  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function relative(file) {
  return path.relative(projectRoot, file);
}

function attributeRegions(source, attribute) {
  const regions = [];
  const quoted = new RegExp(`\\b${attribute}\\s*=\\s*(["'\\x60])([\\s\\S]*?)\\1`, 'g');
  const expression = new RegExp(`\\b${attribute}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'g');

  for (const match of source.matchAll(quoted)) {
    regions.push({ source: match[2], offset: match.index + match[0].indexOf(match[2]) });
  }
  for (const match of source.matchAll(expression)) {
    regions.push({ source: match[1], offset: match.index + match[0].indexOf(match[1]) });
  }

  return regions;
}

const tokenSource = await readFile(tokenFile, 'utf8');
const semanticTokens = new Set(
  [...tokenSource.matchAll(/^\s*--text-([a-z0-9]+(?:-[a-z0-9]+)*):/gm)]
    .map((match) => `text-${match[1]}`),
);
const violations = [];

for (const file of await collectFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');

  if (path.extname(file) !== '.css') {
    const classRegions = [
      ...attributeRegions(source, 'class'),
      ...attributeRegions(source, 'className'),
      ...attributeRegions(source, 'class:list'),
    ];

    for (const region of classRegions) {
      for (const match of region.source.matchAll(rawUtilityPattern)) {
        if (!semanticTokens.has(match[1])) {
          violations.push({
            file,
            line: lineNumberAt(source, region.offset + match.index),
            message: `raw typography utility "${match[1]}"`,
          });
        }
      }
    }

    const styleRegions = [
      ...attributeRegions(source, 'style'),
      ...[...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map((match) => ({
        source: match[1],
        offset: match.index + match[0].indexOf(match[1]),
      })),
    ];

    for (const region of styleRegions) {
      for (const match of region.source.matchAll(typographyDeclarationPattern)) {
        if (!match[2].includes('var(--text-')) {
          violations.push({
            file,
            line: lineNumberAt(source, region.offset + match.index),
            message: `inline ${match[1]} must reference a --text-* token`,
          });
        }
      }
    }
    continue;
  }

  for (const match of source.matchAll(typographyDeclarationPattern)) {
    const declarationStart = match.index;
    const lineStart = source.lastIndexOf('\n', declarationStart) + 1;
    const declarationPrefix = source.slice(lineStart, declarationStart);
    const definesToken = /--text-[a-z0-9-]+--\s*$/.test(declarationPrefix);

    if (!definesToken && !match[2].includes('var(--text-')) {
      violations.push({
        file,
        line: lineNumberAt(source, declarationStart),
        message: `${match[1]} must reference a --text-* token`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Typography token check failed:\n');
  for (const violation of violations) {
    console.error(`  ${relative(violation.file)}:${violation.line}  ${violation.message}`);
  }
  console.error('\nUse one of: ' + [...semanticTokens].sort().join(', '));
  process.exitCode = 1;
} else {
  console.log(`Typography token check passed (${semanticTokens.size} semantic tokens).`);
}
