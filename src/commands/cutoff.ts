import { info, sectionWithNote, title, warn } from '../lib/ui.js';
import {
  parseCutoffTimestamp,
  readLinkedMigrationAlignment,
  resolvePostSeedCutoff,
} from '../lib/post-seed-cutoff.js';

export type CutoffDetectOptions = {
  env?: string;
  json?: boolean;
};

function sourceLabel(source: 'argument' | 'linked' | 'config') {
  if (source === 'linked') return 'linked migration alignment';
  if (source === 'config') return 'configured fallback';
  return 'explicit argument';
}

export async function runCutoffDetectCommand(
  cutoffTimestampRaw: string | undefined,
  options: CutoffDetectOptions = {},
) {
  const resolved = await resolvePostSeedCutoff(cutoffTimestampRaw, { env: options.env });
  const cutoffAsNumber = parseCutoffTimestamp(resolved.value);

  let alignment: Awaited<ReturnType<typeof readLinkedMigrationAlignment>> | null = null;
  let alignmentError: string | null = null;
  try {
    alignment = await readLinkedMigrationAlignment();
  } catch (error) {
    alignmentError = error instanceof Error ? error.message : String(error);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          cutoff: resolved.value,
          cutoffAsNumber,
          source: resolved.source,
          env: options.env ?? null,
          latestLocal: alignment?.latestLocal ?? null,
          latestRemote: alignment?.latestRemote ?? null,
          latestAligned: alignment?.latestAligned ?? null,
          alignmentError,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(sectionWithNote(title('Cutoff detect'), 'Detects post-seed cutoff using argument, linked alignment, or config fallback.'));
  console.log(info(`cutoff = ${resolved.value}`));
  console.log(info(`source = ${sourceLabel(resolved.source)}`));
  if (options.env) {
    console.log(info(`env = ${options.env}`));
  }

  if (alignment) {
    console.log(info(`latestLocal = ${alignment.latestLocal ?? '(none)'}`));
    console.log(info(`latestRemote = ${alignment.latestRemote ?? '(none)'}`));
    console.log(info(`latestAligned = ${alignment.latestAligned ?? '(none)'}`));
  } else if (alignmentError) {
    console.log(warn(`Linked alignment unavailable: ${alignmentError}`));
  }
}
