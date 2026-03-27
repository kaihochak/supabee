// @ts-nocheck
export async function runSubcommandMode(commandName, subcommand, handlers) {
  const validSubcommands = ['split', 'reconstruct', 'validate'];

  if (!subcommand) {
    await handlers.split();
    await handlers.reconstruct();
    const isValid = await handlers.validate();
    if (!isValid) process.exit(1);
    return;
  }

  if (!validSubcommands.includes(subcommand)) {
    console.error(`Unsupported ${commandName} command: ${subcommand}`);
    process.exit(1);
  }

  if (subcommand === 'split') {
    await handlers.split();
    return;
  }

  if (subcommand === 'reconstruct') {
    await handlers.reconstruct();
    return;
  }

  const isValid = await handlers.validate();
  if (!isValid) process.exit(1);
}
