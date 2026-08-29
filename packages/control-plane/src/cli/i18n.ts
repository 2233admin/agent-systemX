export type Lang = 'zh' | 'en';
export function resolveLang(): Lang { return process.env.CONFIGS_LANG === 'en' ? 'en' : 'zh'; }
const translations = {
  zh: { 'confirmation.prompt': '是否继续启动？[y/N] ', 'selfUpdate.updated': 'configs：已更新到 v{version}（当前已生效）' },
  en: { 'confirmation.prompt': 'Continue activation? [y/N] ', 'selfUpdate.updated': 'configs: updated to v{version} (now in effect)' },
} as const;
export type TranslationKey = keyof typeof translations.zh;
export function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string {
  let text: string = translations[resolveLang()][key];
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
