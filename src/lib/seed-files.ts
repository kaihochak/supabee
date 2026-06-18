import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SUPABASE_DIR = 'supabase';
export const DEFAULT_CONFIG_PATH = 'supabase/config.toml';

export type SeedFile = {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to cwd, for display (e.g. supabase/seeds/split/001.sql). */
  relPath: string;
  /** Just the file name (e.g. 001.sql), used for --from matching. */
  basename: string;
};

export type SeedDiscovery = {
  /** Ordered seed files, ready to apply. */
  files: SeedFile[];
  /** The raw sql_paths globs from config.toml, in declared order. */
  patterns: string[];
};

/** Extract quoted string entries from a TOML array literal (single or multi-line). */
function parseTomlArrayString(value: string): string[] {
  const matches = value.matchAll(/['"]([^'"]+)['"]/g);
  return Array.from(matches, (match) => match[1]);
}

/**
 * Read `sql_paths` from the `[db.seed]` table of a Supabase config.toml.
 * Handles both single-line and multi-line array literals. Returns [] if absent.
 */
export function readSeedSqlPaths(configPath: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(`Could not read Supabase config: ${configPath}`);
  }

  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[db.seed]');
  if (start === -1) return [];

  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('[')) break; // next table — sql_paths not found
    if (!trimmed.startsWith('sql_paths')) continue;

    // Accumulate from the '=' until the closing ']' (array may span lines).
    let raw = lines[i].slice(lines[i].indexOf('=') + 1);
    let cursor = i;
    while (!raw.includes(']') && cursor + 1 < lines.length) {
      cursor += 1;
      raw += `\n${lines[cursor]}`;
    }
    return parseTomlArrayString(raw);
  }

  return [];
}

/** Convert one path segment glob (only `*` is special) to an anchored RegExp. */
function segmentToRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Expand a glob pattern against baseDir. A `*` is special within any path
 * segment (file or directory), so patterns like "seeds/split/[star].sql" or a
 * one-level directory wildcard "seeding_sql/[star]/[star].seed.sql" both work.
 * Returns absolute file paths, lexically sorted — matching how Supabase orders
 * globbed seed files.
 */
function expandGlob(baseDir: string, pattern: string): string[] {
  const normalized = pattern.replace(/^\.\//, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  let current = [baseDir];

  for (let i = 0; i < segments.length; i += 1) {
    const isLast = i === segments.length - 1;
    const matcher = segmentToRegExp(segments[i]);
    const next: string[] = [];

    for (const dir of current) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!matcher.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (isLast) {
          if (entry.isFile()) next.push(full);
        } else if (entry.isDirectory()) {
          next.push(full);
        }
      }
    }
    current = next;
  }

  return current.sort();
}

/**
 * Discover the ordered seed file queue from a Supabase project's config.toml.
 * Patterns are expanded in declared order; files within each pattern are sorted
 * lexically and de-duplicated across patterns (first occurrence wins).
 */
export function discoverSeedFiles(
  options: { configPath?: string; supabaseDir?: string; cwd?: string } = {},
): SeedDiscovery {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.resolve(cwd, options.configPath ?? DEFAULT_CONFIG_PATH);
  const supabaseDir = path.resolve(cwd, options.supabaseDir ?? DEFAULT_SUPABASE_DIR);

  const patterns = readSeedSqlPaths(configPath);
  const seen = new Set<string>();
  const files: SeedFile[] = [];

  for (const pattern of patterns) {
    for (const absPath of expandGlob(supabaseDir, pattern)) {
      if (seen.has(absPath)) continue;
      seen.add(absPath);
      files.push({
        absPath,
        relPath: path.relative(cwd, absPath),
        basename: path.basename(absPath),
      });
    }
  }

  return { files, patterns };
}
