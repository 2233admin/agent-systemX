import { spawn } from 'node:child_process';
import type { ProcessPort, ProcessResult } from '../../ports/process.ts';

export class BunProcessPort implements ProcessPort {
  public async run(command: string, args: readonly string[], cwd: string): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd, shell: false, windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (exitCode, signal) => resolve({ exitCode: exitCode ?? (signal === null ? 1 : null), stdout, stderr }));
    });
  }
}
