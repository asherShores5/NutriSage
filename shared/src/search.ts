// Fuzzy search over the Library (spec: Fuzzy search). Client-side and pure: the add box ranks the
// Library as you type. Each typed word is scored against the item's best-matching word (exact,
// start of a word, letters in order like "brst" in "breast", or a word or two off by a typo); an item's score is the average over
// the typed words. Favorites (ticket 14 passes them in) rank first among the matches.

/** Anything searchable by name: a Food now, a Recipe later. */
export interface Searchable {
  id: string;
  name: string;
}

export interface SearchHit<T extends Searchable> {
  item: T;
  /** 0..1, higher is better. */
  score: number;
  /** The text is the item's whole name (case, spacing, punctuation and a typo in a long word aside). */
  whole: boolean;
  /**
   * The text covers the name: every word of the name is matched by a typed word and every typed
   * word by a word of the name (partial words and typos allowed; a typed count is the amount, a number in the name must be typed). "chik brst" covers
   * Chicken breast; "apple" doesn't cover Apple pie, nor "chicken breast sandwich" Chicken breast.
   */
  covers: boolean;
}

export interface SearchOptions {
  /** The searcher's Favorites (Library item ids): they rank above every other match. */
  favoriteIds?: ReadonlySet<string>;
  /** At most this many hits. */
  limit?: number;
}

/** Lower case words of letters and digits. */
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];

/** Whether the letters of `q` appear in `w` in order, starting with the same letter. */
function inOrder(q: string, w: string) {
  if (q[0] !== w[0]) return false;
  let i = 0;
  for (const ch of w) if (ch === q[i]) i++;
  return i === q.length;
}

/** Typos allowed in a typed word: none in short words, where one wrong letter is a different word. */
const allowedTypos = (q: string) => (q.length < 4 ? 0 : q.length < 8 ? 1 : 2);

/**
 * Fewest single-letter edits (insert, delete, replace, swap two neighbours) turning `q` into each
 * start of `w`: index j is the edits to `w.slice(0, j)`, so the last is the edits to all of `w`.
 */
function typoRow(q: string, w: string): number[] {
  // Rows of the optimal-string-alignment table; the answer is the best cell in the last row.
  let prev2: number[] = [];
  let prev = Array.from({ length: w.length + 1 }, (_, j) => j);
  for (let i = 1; i <= q.length; i++) {
    const row = [i];
    for (let j = 1; j <= w.length; j++) {
      const cost = q[i - 1] === w[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && q[i - 1] === w[j - 2] && q[i - 2] === w[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
    }
    prev2 = prev;
    prev = row;
  }
  return prev;
}

/** Edits to the nearest start of `w`, so a typo in a half-typed word still counts. */
const typosToPrefix = (q: string, w: string) => Math.min(...typoRow(q, w));

/** Whether a typed word is this word of the name: equal, or one typo off a long word (pear isn't peas). */
const sameWord = (q: string, w: string) => q === w || (q.length >= 6 && w.length >= 6 && typoRow(q, w)[w.length] <= 1);

/** Whether the typed words are the name's words, in order. */
const wholeName = (query: string[], name: string[]) => query.length === name.length && query.every((q, i) => sameWord(q, name[i]));

/** How well one typed word matches one word of the name, 0..1. */
function wordScore(q: string, w: string): number {
  if (q === w) return 1;
  if (w.startsWith(q)) return 0.8 + 0.15 * (q.length / w.length);
  if (q.length >= 2 && inOrder(q, w)) return 0.55 + 0.25 * (q.length / w.length);
  const allowed = allowedTypos(q);
  if (!allowed) return 0;
  const typos = typosToPrefix(q, w);
  return typos <= allowed ? 0.5 + 0.25 * Math.min(1, q.length / w.length) - 0.1 * (typos - 1) : 0;
}

const isCount = (w: string) => /^[0-9]+$/.test(w);

/** Whether the typed words cover the name's words, both ways (see SearchHit.covers). */
function coversName(query: string[], name: string[]): boolean {
  // A typed count ("2 chik brst") is the amount; a number in the name is part of the name.
  const q = query.filter((w) => !isCount(w));
  const n = name.filter((w) => !isCount(w));
  if (!q.length || !n.length) return false;
  if (name.some((w) => isCount(w) && !query.includes(w))) return false;
  return n.every((w) => q.some((x) => wordScore(x, w) > 0)) && q.every((x) => n.some((w) => wordScore(x, w) > 0));
}

/**
 * How well the query matches a name, 0..1: the average over typed words. A typed count ("2" in
 * "2 bananas") is usually the amount, not the name, so it only nudges the order when it matches.
 */
function nameScore(query: string[], name: string[]): number {
  if (!query.length || !name.length) return 0;
  const best = (q: string) => Math.max(...name.map((w) => wordScore(q, w)));
  const named = query.filter((q) => !isCount(q));
  if (!named.length) return query.reduce((t, q) => t + best(q), 0) / query.length;
  const counts = query.filter(isCount).filter((q) => best(q) === 1).length;
  return Math.min(1, named.reduce((t, q) => t + best(q), 0) / named.length + 0.02 * counts);
}

/** Below this an item isn't a match: most typed words must find a word in the name. */
export const MIN_SEARCH_SCORE = 0.5;

const NO_FAVORITES: ReadonlySet<string> = new Set();

/** The Library items matching the typed text: Favorites first, then the whole name, then best match, shortest name. */
export function searchLibrary<T extends Searchable>(library: readonly T[], query: string, opts: SearchOptions = {}): SearchHit<T>[] {
  const { limit = 8, favoriteIds = NO_FAVORITES } = opts;
  const fav = (h: SearchHit<T>) => (favoriteIds.has(h.item.id) ? 1 : 0);
  const q = words(query);
  if (!q.length) return [];
  return library
    .map((item) => {
      const name = words(item.name);
      return { item, score: nameScore(q, name), whole: wholeName(q, name), covers: coversName(q, name), size: name.length };
    })
    .filter((h) => h.score >= MIN_SEARCH_SCORE)
    .sort((a, b) => fav(b) - fav(a) || +b.whole - +a.whole || b.score - a.score || a.size - b.size || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(({ item, score, whole, covers }) => ({ item, score, whole, covers }));
}

/**
 * What Enter logs in the add box: the best match whose name the text covers (SearchHit.covers),
 * else nothing, so Enter estimates the text as a new Food.
 */
export function enterMatch<T extends Searchable>(hits: readonly SearchHit<T>[]): T | undefined {
  return hits.find((h) => h.covers)?.item;
}
