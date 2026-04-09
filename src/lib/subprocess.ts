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

function getCommandCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command];
  if (path.extname(command) || command.includes('/') || command.includes('\\')) return [command];
  return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`];
}

function isCommandNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Failed to start command:') && error.message.includes('ENOENT');
}

function withWindowsCommandNotFoundDiagnostic(command: string, error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  if (process.platform !== 'win32' || !isCommandNotFoundError(error)) {
    return error;
  }

  return new Error(
    `${error.message}

Windows diagnostic:
- Tried command variants automatically: ${command}, ${command}.exe, ${command}.cmd, ${command}.bat
- In PowerShell, run \`where.exe ${command}\` (not \`where ${command}\`, which maps to Where-Object)
- Check resolution in pnpm context: \`pnpm exec where.exe ${command}\`
- If still missing, reinstall the CLI and ensure its bin path is on PATH (common npm global bin: %AppData%\\npm)`,
  );
}

async function runWithCommandFallback(
  command: string,
  args: string[],
  runWithResolvedCommand: (resolvedCommand: string) => Promise<void>,
) {
  const candidates = getCommandCandidates(command);
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      await runWithResolvedCommand(candidate);
      return;
    } catch (error) {
      lastError = error;
      const hasMoreCandidates = index < candidates.length - 1;
      if (!hasMoreCandidates || !isCommandNotFoundError(error)) {
        throw withWindowsCommandNotFoundDiagnostic(command, error);
      }
    }
  }

  if (lastError) throw withWindowsCommandNotFoundDiagnostic(command, lastError);
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
  await runWithCommandFallback(command, args, async (resolvedCommand) => {
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      env: getMergedEnv(options.env),
      stdio: 'inherit',
    });

    await waitForExit(resolvedCommand, args, child);
  });
}

export async function runCommandToFile(
  command: string,
  args: string[],
  outputPath: string,
  options: RunCommandOptions = {},
) {
  const absoluteOutputPath = path.resolve(outputPath);
  await fs.promises.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  await runWithCommandFallback(command, args, async (resolvedCommand) => {
    const outputStream = fs.createWriteStream(absoluteOutputPath, { encoding: 'utf8' });
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      env: getMergedEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.stdout || !child.stderr) {
      outputStream.destroy();
      throw new Error(`Unable to capture command output: ${formatCommand(resolvedCommand, args)}`);
    }

    const streamDone = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.stdout.pipe(outputStream);

    await Promise.all([waitForExit(resolvedCommand, args, child), streamDone]);
  });
}

export async function runCommandCapture(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandCaptureResult> {
  let result: RunCommandCaptureResult = { stdout: '', stderr: '' };

  await runWithCommandFallback(command, args, async (resolvedCommand) => {
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      env: getMergedEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.stdout || !child.stderr) {
      throw new Error(`Unable to capture command output: ${formatCommand(resolvedCommand, args)}`);
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on('error', (error) => {
        reject(new Error(`Failed to start command: ${formatCommand(resolvedCommand, args)}\n${error.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const stderrMessage = stderr.trim();
        reject(
          new Error(
            stderrMessage
              ? `Command failed (${code}): ${formatCommand(resolvedCommand, args)}\n${stderrMessage}`
              : `Command failed (${code}): ${formatCommand(resolvedCommand, args)}`,
          ),
        );
      });
    });

    result = { stdout, stderr };
  });

  return result;
}
