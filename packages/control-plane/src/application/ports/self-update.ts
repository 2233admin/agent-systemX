export interface SelfUpdatePort {
  checkAndApply(currentVersion: string): Promise<string | null>;
}
