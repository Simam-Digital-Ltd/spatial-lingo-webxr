/**
 * Bring-your-own-key storage.
 *
 * The app is a static site with no backend, so there is nowhere to put a
 * shared API key that would not also be handing it to everyone who opens the
 * page. Instead the learner supplies their own, it stays in their browser, and
 * requests go straight from that browser to Google. Nothing is proxied,
 * nothing is logged, and this repository never sees a key.
 *
 * The honest framing matters and is repeated in the interface: a browser
 * profile is not a secret store. Anyone with access to this browser can read
 * the key back out of `localStorage`, exactly as they could read a saved
 * password. That is an acceptable trade for a key the user chose to paste into
 * a demo, and it is not one to make quietly — hence the warning text and the
 * always-available "forget" control.
 *
 * `docs/roadmap/00-google-stack.md` describes the other two tiers: a shared
 * key behind a metered proxy, and the keyless default that works with no key
 * at all and always will.
 */

const KEY_STORAGE = 'spatial-lingo:gemini-key:v1';
const MODEL_STORAGE = 'spatial-lingo:gemini-model:v1';

/**
 * Default model.
 *
 * Overridable from the settings panel on purpose. Model identifiers are
 * retired and renamed on a schedule this repository does not control, so a
 * hard-coded default that goes stale would otherwise need a code change and a
 * redeploy to fix. This way anyone hitting a 404 can type a current name and
 * carry on.
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Rejects obvious non-keys before spending a network round trip on them. */
export function looksLikeKey(candidate: string): boolean {
  const trimmed = candidate.trim();
  // Google API keys are longer than this and carry no whitespace. This is a
  // typo check, not validation — only the API can say whether a key works.
  return trimmed.length >= 20 && !/\s/.test(trimmed);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The learner's own Gemini key and model choice, kept on their device. */
export class ApiKeyStore {
  readonly #storage: Storage | null;

  constructor(storage: Storage | null = safeStorage()) {
    this.#storage = storage;
  }

  get key(): string | null {
    return this.#read(KEY_STORAGE);
  }

  get model(): string {
    return this.#read(MODEL_STORAGE) ?? DEFAULT_MODEL;
  }

  get hasKey(): boolean {
    return this.key !== null;
  }

  save(key: string, model: string): void {
    this.#write(KEY_STORAGE, key.trim());
    this.#write(MODEL_STORAGE, model.trim() || DEFAULT_MODEL);
  }

  /** Removes the key and the model override. */
  forget(): void {
    if (!this.#storage) return;
    try {
      this.#storage.removeItem(KEY_STORAGE);
      this.#storage.removeItem(MODEL_STORAGE);
    } catch {
      // Nothing to do, and nothing worth interrupting the learner over.
    }
  }

  #read(name: string): string | null {
    if (!this.#storage) return null;
    try {
      const value = this.#storage.getItem(name);
      return value && value.trim().length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  #write(name: string, value: string): void {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(name, value);
    } catch {
      // Quota, or a blocked store. The key simply will not persist.
    }
  }
}
