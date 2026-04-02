import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type RunCommandCaptureResult = {
  stdout: string;
  stderr: string;
};

function formatCommand(command: string, args: string[]) {
  return [command, ...args].join(' ');
}

function getMergedEnv(env?: NodeJS.ProcessEnv) {
  return env ? { ...process.env, ...env } : process.env;
}

function waitForExit(command: string, args: string[], child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      reject(new Error(`Failed to start command: ${formatCommand(command, args)}\n${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed (${code}): ${formatCommand(command, args)}`));
    });
  });
}

export async function runCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: getMergedEnv(options.env),
    stdio: 'inherit',
  });

  await waitForExit(command, args, child);
}

export async function runCommandToFile(
  command: string,
  args: string[],
  outputPath: string,
  options: RunCommandOptions = {},
) {
  const absoluteOutputPath = path.resolve(outputPath);
  await fs.promises.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const outputStream = fs.createWriteStream(absoluteOutputPath, { encoding: 'utf8' });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: getMergedEnv(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.stdout || !child.stderr) {
    throw new Error(`Unable to capture command output: ${formatCommand(command, args)}`);
  }

  const streamDone = new Promise<void>((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.stdout.pipe(outputStream);

  await Promise.all([waitForExit(command, args, child), streamDone]);
}

export async function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandCaptureResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: getMergedEnv(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.stdout || !child.stderr) {
    throw new Error(`Unable to capture command output: ${formatCommand(command, args)}`);
  }

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForExit(command, args, child);
  return { stdout, stderr };
}
