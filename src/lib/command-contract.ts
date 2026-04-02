export type StepName = 'split' | 'reconstruct' | 'validate';

export type StepCommandOptions = {
  input: string | null;
  output: string | null;
  backup: boolean | null;
  help: boolean;
  positional: string[];
};

export type ParsedStepCommandArgs = {
  subcommand: string | null;
  options: StepCommandOptions;
  isUnknownSubcommand: boolean;
};

export type ResolvedStepPaths = {
  inputFile: string;
  outputDir: string;
  reconstructedFile: string;
};

type ResolveStepPathsInput = {
  defaults: ResolvedStepPaths;
  options: StepCommandOptions;
  subcommand: string | null;
  step: StepName;
};

export function parseStepCommandArgs(args: string[]): ParsedStepCommandArgs {
  const knownSubcommands = new Set(['split', 'reconstruct', 'validate']);
  let subcommand: string | null = null;
  let cursor = 0;

  if (args[0] && !args[0].startsWith('-')) {
    subcommand = args[0];
    cursor = 1;
  }

  const options: StepCommandOptions = {
    input: null,
    output: null,
    backup: null,
    help: false,
    positional: [],
  };

  for (let i = cursor; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--input' && args[i + 1]) {
      options.input = args[i + 1];
      i += 1;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i += 1;
    } else if (arg === '--backup') {
      options.backup = true;
    } else if (arg === '--no-backup') {
      options.backup = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      options.positional.push(arg);
    }
  }

  if (subcommand && !knownSubcommands.has(subcommand)) {
    return { subcommand, options, isUnknownSubcommand: true };
  }

  return { subcommand, options, isUnknownSubcommand: false };
}

export function printStepCommandHelp(commandName) {
  console.log(`${commandName} command:
  supabee ${commandName}

Advanced:
  supabee ${commandName} [split|reconstruct|validate] [--input <path>] [--output <dir>] [--backup] [--no-backup]

Notes:
  - No subcommand runs: split -> reconstruct -> validate
  - split: --input=source.sql, --output=split-dir
  - split backup behavior defaults from config (backup=false by default)
  - reconstruct: --input=split-dir, --output=reconstructed.sql
  - validate: --input=source.sql, --output=reconstructed.sql (or positional reconstructed path)
`);
}

export function resolveStepPaths({ defaults, options, subcommand, step }: ResolveStepPathsInput): ResolvedStepPaths {
  const inputFromCli = options.input;
  const outputFromCli = options.output;
  const positionalReconstructed = options.positional[0];

  if (!subcommand) {
    return {
      inputFile: inputFromCli || defaults.inputFile,
      outputDir: outputFromCli || defaults.outputDir,
      reconstructedFile: defaults.reconstructedFile,
    };
  }

  if (step === 'split') {
    return {
      inputFile: inputFromCli || defaults.inputFile,
      outputDir: outputFromCli || defaults.outputDir,
      reconstructedFile: defaults.reconstructedFile,
    };
  }

  if (step === 'reconstruct') {
    const splitDir = inputFromCli || defaults.outputDir;
    return {
      inputFile: defaults.inputFile,
      outputDir: splitDir,
      reconstructedFile: outputFromCli || defaults.reconstructedFile,
    };
  }

  return {
    inputFile: inputFromCli || defaults.inputFile,
    outputDir: defaults.outputDir,
    reconstructedFile: outputFromCli || positionalReconstructed || defaults.reconstructedFile,
  };
}
