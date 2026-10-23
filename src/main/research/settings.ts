/**
 * Persisted controls for the research / stealth pipeline.
 *
 * These settings affect `search_web`, `deep_crawl`, and `research_topic`:
 * provider preference, an isolated research session (optionally proxied),
 * per-domain cooldowns after a WAF/challenge, and politeness delays.
 *
 * They are deliberately stored in `<userData>`, not beside the repo.
 */

import fs from 'node:fs';
import path from 'node:path';

export const RESEARCH_ENGINES = ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'custom'] as const;

export interface ResearchSettings {
  schemaVersion: 1;
  enabled: boolean;
  engineChain: string[];
  urlTemplate: string;
  proxyUrl: string;
  domainCooldownSec: number;
  delayMs: number;
  activateView: boolean;
  /** Parallel page fetches inside one deep_crawl (1 = sequential). */
  crawlConcurrency: number;
  /** Try content-negotiated Markdown/Text before rendering. */
  preferLlm: boolean;
  defaultMaxPages: number;
  defaultMaxSources: number;
  searchMaxResults: number;
}

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  schemaVersion: 1,
  enabled: false,
  engineChain: ['duckduckgo', 'brave', 'google'],
  urlTemplate: '',
  proxyUrl: '',
  domainCooldownSec: 300,
  delayMs: 1000,
  activateView: true,
  crawlConcurrency: 1,
  preferLlm: true,
  defaultMaxPages: 5,
  defaultMaxSources: 5,
  searchMaxResults: 8,
};

export interface ResearchSettingsResult {
  ok: boolean;
  settings: ResearchSettings;
  errors: string[];
}

export class ResearchSettingsStore {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  load(): ResearchSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const normalized = normalizeResearchSettings(parsed);
      return normalized.ok ? normalized.settings : { ...DEFAULT_RESEARCH_SETTINGS, engineChain: [...DEFAULT_RESEARCH_SETTINGS.engineChain] };
    } catch {
      return { ...DEFAULT_RESEARCH_SETTINGS, engineChain: [...DEFAULT_RESEARCH_SETTINGS.engineChain] };
    }
  }

  save(input: unknown): ResearchSettingsResult {
    const normalized = normalizeResearchSettings(input);
    if (!normalized.ok) return normalized;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(normalized.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
      return normalized;
    } catch (err: any) {
      return { ...normalized, ok: false, errors: [`Could not save research settings: ${err?.message || err}`] };
    }
  }
}

export function normalizeResearchSettings(input: unknown): ResearchSettingsResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, settings: cloneDefaults(), errors: ['settings must be an object'] };
  }

  const source = input as Record<string, any>;
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_RESEARCH_SETTINGS.enabled;
  const activateView =
    typeof source.activateView === 'boolean' ? source.activateView : DEFAULT_RESEARCH_SETTINGS.activateView;

  let engineChain: string[];
  if (source.engineChain === undefined) {
    engineChain = [...DEFAULT_RESEARCH_SETTINGS.engineChain];
  } else if (typeof source.engineChain === 'string') {
    engineChain = source.engineChain.split(/[,\s>]+/).map((item: string) => item.trim().toLowerCase()).filter(Boolean);
  } else if (Array.isArray(source.engineChain)) {
    engineChain = source.engineChain.map((item: unknown) => String(item).trim().toLowerCase()).filter(Boolean);
  } else {
    engineChain = [...DEFAULT_RESEARCH_SETTINGS.engineChain];
    errors.push('engineChain must be an array or comma-separated string');
  }

  engineChain = [...new Set(engineChain)];
  if (engineChain.length === 0) errors.push('engineChain must contain at least one engine');
  if (engineChain.length > 6) errors.push('engineChain must contain at most 6 engines');
  for (const engine of engineChain) {
    if (!(RESEARCH_ENGINES as readonly string[]).includes(engine)) errors.push(`unknown engine "${engine}"`);
  }

  const urlTemplate =
    typeof source.urlTemplate === 'string' ? source.urlTemplate.trim() : DEFAULT_RESEARCH_SETTINGS.urlTemplate;
  if (urlTemplate && !urlTemplate.includes('{query}')) {
    errors.push('urlTemplate must contain {query}');
  }
  if (urlTemplate.length > 2000) errors.push('urlTemplate must be 2000 characters or fewer');
  if (engineChain.includes('custom') && !urlTemplate) errors.push('the custom engine needs a urlTemplate containing {query}');

  const proxyUrl = typeof source.proxyUrl === 'string' ? source.proxyUrl.trim() : DEFAULT_RESEARCH_SETTINGS.proxyUrl;
  if (proxyUrl.length > 1000) errors.push('proxyUrl must be 1000 characters or fewer');
  if (proxyUrl && /\s/.test(proxyUrl)) errors.push('proxyUrl must not contain whitespace');
  if (proxyUrl && !/^(https?|socks4a?|socks5h?):\/\//i.test(proxyUrl)) {
    errors.push('proxyUrl must start with http://, https://, socks4://, socks4a://, socks5://, or socks5h://');
  }

  const domainCooldownSec = integerInRange(
    source.domainCooldownSec,
    DEFAULT_RESEARCH_SETTINGS.domainCooldownSec,
    30,
    86_400,
    'domainCooldownSec',
    errors,
  );
  const delayMs = integerInRange(source.delayMs, DEFAULT_RESEARCH_SETTINGS.delayMs, 0, 10_000, 'delayMs', errors);
  const crawlConcurrency = integerInRange(
    source.crawlConcurrency,
    DEFAULT_RESEARCH_SETTINGS.crawlConcurrency,
    1,
    4,
    'crawlConcurrency',
    errors,
  );
  const defaultMaxPages = integerInRange(
    source.defaultMaxPages,
    DEFAULT_RESEARCH_SETTINGS.defaultMaxPages,
    1,
    25,
    'defaultMaxPages',
    errors,
  );
  const defaultMaxSources = integerInRange(
    source.defaultMaxSources,
    DEFAULT_RESEARCH_SETTINGS.defaultMaxSources,
    1,
    8,
    'defaultMaxSources',
    errors,
  );
  const searchMaxResults = integerInRange(
    source.searchMaxResults,
    DEFAULT_RESEARCH_SETTINGS.searchMaxResults,
    1,
    25,
    'searchMaxResults',
    errors,
  );
  const preferLlm = typeof source.preferLlm === 'boolean' ? source.preferLlm : DEFAULT_RESEARCH_SETTINGS.preferLlm;

  if (errors.length > 0) {
    return { ok: false, settings: cloneDefaults(), errors };
  }

  return {
    ok: true,
    settings: {
      schemaVersion: 1,
      enabled,
      engineChain,
      urlTemplate,
      proxyUrl,
      domainCooldownSec,
      delayMs,
      activateView,
      crawlConcurrency,
      preferLlm,
      defaultMaxPages,
      defaultMaxSources,
      searchMaxResults,
    },
    errors: [],
  };
}

function integerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
  errors: string[],
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    errors.push(`${field} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return number;
}

function cloneDefaults(): ResearchSettings {
  return { ...DEFAULT_RESEARCH_SETTINGS, engineChain: [...DEFAULT_RESEARCH_SETTINGS.engineChain] };
}

/** Shared challenge detector for rendered crawl/search pages. */
const CHALLENGE_PATTERNS = [
  /aws\s*waf/i,
  /captcha/i,
  /verify (that )?you are human/i,
  /unusual traffic/i,
  /automated (queries|requests)/i,
  /access denied/i,
  /request blocked/i,
  /cloudflare/i,
  /cf-chl/i,
  /datadome/i,
  /akamai/i,
  /robot check/i,
  /enable javascript and cookies/i,
  /before you continue/i,
];

export function looksLikeChallenge(status: number, text: string): boolean {
  if (status === 403 || status === 429) return true;
  const sample = (text || '').slice(0, 4000);
  return CHALLENGE_PATTERNS.some((pattern) => pattern.test(sample));
}
