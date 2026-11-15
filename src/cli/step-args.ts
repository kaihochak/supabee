export type StepCliOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
  force?: boolean;
  sync?: boolean;
};

export function buildStepArgs(step?: string, reconstructed?: string, options: StepCliOptions = {}): string[] {
  const args: string[] = [];
  if (step) args.push(step);
  if (options.input) args.push('--input', options.input);
  if (options.output) args.push('--output', options.output);
  if (options.backup === false) {
    args.push('--no-backup');
  } else if (options.backup) {
    args.push('--backup');
  }
  if (reconstructed) args.push(reconstructed);
  return args;
}
