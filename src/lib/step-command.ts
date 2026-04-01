import { runSubcommandMode } from './command-mode.js';
import {
  parseStepCommandArgs,
  printStepCommandHelp,
  resolveStepPaths,
  type ResolvedStepPaths,
  type StepCommandOptions,
  type StepName,
} from './command-contract.js';
import { sectionWithNote, title } from './ui.js';

type ActionContext<TConfig> = {
  config: TConfig;
  options: StepCommandOptions;
  defaults: TConfig;
  subcommand: string | null;
};

type StepCommandDefinition<TConfig extends ResolvedStepPaths> = {
  commandName: string;
  commandDisplayName: string;
  detailNote: ((step: StepName) => string) | string;
  buildDefaults: (options?: StepCommandOptions) => TConfig;
  buildStepConfig?: (params: {
    step: StepName;
    defaults: TConfig;
    options: StepCommandOptions;
    subcommand: string | null;
  }) => TConfig;
  getDetailLines: ((step: StepName, config: TConfig) => string[]) | string[];
  actions: {
    split: (context: ActionContext<TConfig>) => Promise<unknown>;
    reconstruct: (context: ActionContext<TConfig>) => Promise<unknown>;
    validate: (context: ActionContext<TConfig>) => Promise<boolean>;
  };
};

function printStepDetails(commandDisplayName: string, step: StepName, note: string, detailLines: string[]) {
  console.log(sectionWithNote(title(`${commandDisplayName} ${step}`), note));
  for (const line of detailLines) {
    console.log(line);
  }
  console.log('');
}

export async function runStepCommand<TConfig extends ResolvedStepPaths>(
  args: string[],
  definition: StepCommandDefinition<TConfig>,
) {
  const { commandName, commandDisplayName, detailNote, buildDefaults, buildStepConfig, getDetailLines, actions } = definition;
  const { subcommand, options, isUnknownSubcommand } = parseStepCommandArgs(args);

  if (options.help) {
    printStepCommandHelp(commandName);
    return;
  }

  if (isUnknownSubcommand) {
    console.error(`Unsupported ${commandName} command: ${subcommand}`);
    process.exit(1);
  }

  const defaults = buildDefaults(options);
  const resolveDetailNote = (step: StepName) => (typeof detailNote === 'function' ? detailNote(step) : detailNote);
  const resolveDetailLines = (step: StepName, config: TConfig) =>
    (typeof getDetailLines === 'function' ? getDetailLines(step, config) : getDetailLines) ?? [];

  const resolveStepConfig = (step: StepName): TConfig => {
    if (buildStepConfig) return buildStepConfig({ step, defaults, options, subcommand });
    const stepPaths = resolveStepPaths({ defaults, options, subcommand, step });
    return {
      ...defaults,
      ...stepPaths,
    };
  };

  await runSubcommandMode(commandName, subcommand, {
    split: async () => {
      const config = resolveStepConfig('split');
      printStepDetails(commandDisplayName, 'split', resolveDetailNote('split'), resolveDetailLines('split', config));
      return actions.split({ config, options, defaults, subcommand });
    },
    reconstruct: async () => {
      const config = resolveStepConfig('reconstruct');
      printStepDetails(
        commandDisplayName,
        'reconstruct',
        resolveDetailNote('reconstruct'),
        resolveDetailLines('reconstruct', config),
      );
      return actions.reconstruct({ config, options, defaults, subcommand });
    },
    validate: async () => {
      const config = resolveStepConfig('validate');
      printStepDetails(commandDisplayName, 'validate', resolveDetailNote('validate'), resolveDetailLines('validate', config));
      return actions.validate({ config, options, defaults, subcommand });
    },
  });
}
