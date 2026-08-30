export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessPort {
  run(command: string, args: readonly string[], cwd: string): Promise<ProcessResult>;
}
