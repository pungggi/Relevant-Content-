import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Execute a git command and return trimmed stdout.
 * Throws on non-zero exit code.
 */
export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}
