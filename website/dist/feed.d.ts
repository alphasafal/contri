export const DATA: string;
export const SITE: string;
export function hours(value: number | null | undefined): string;
export function githubUrl(url: string): string | null;
export function ago(iso: string, now?: number): string;
export function languagesOf(issues: Array<{ language: string | null }>): string[];
export function badgeUrl(repo: string): string;
export function badgeMarkdown(repo: string): string;
