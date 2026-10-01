// Klucze Premium: administrator generuje klucz na wybraną liczbę dni (albo bez terminu), kierowca wpisuje go w Ustawienia → Konto.
// Czyste funkcje, testy w premium.test.mjs; zapytania SQL w index.mjs (tabela premium_keys).

/** Bez znaków mylonych przy przepisywaniu (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Bez terminu = data 9999-12-31 (jak w /api/admin/premium). */
export const FOREVER = new Date("9999-12-31T00:00:00Z");
export const MAX_KEY_DAYS = 3650;

/** „RP-7KQM-X2HD” z 8 losowych znaków; `rand(n)` → liczba 0…n-1 (crypto.randomInt). */
export function makeKey(rand) {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[rand(ALPHABET.length)];
  return `RP-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Wpisany klucz → postać kanoniczna albo null: wielkość liter, spacje, myślniki i przedrostek RP nie mają znaczenia; O→0 itd. nie zgadujemy. */
export function normalizeKey(input) {
  const raw = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  const body = raw.startsWith("RP") && raw.length === 10 ? raw.slice(2) : raw;
  if (body.length !== 8 || [...body].some((c) => !ALPHABET.includes(c))) return null;
  return `RP-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Do kiedy Premium po użyciu klucza: dni dokładamy do trwającego Premium (od jego końca), a bez niego — od teraz.
 * days = null → bez terminu. Bez terminu już jest → zostaje.
 */
export function extendPremium(current, days, now) {
  const cur = current ? new Date(current).getTime() : null;
  if (days === null || (cur !== null && cur >= FOREVER.getTime())) return FOREVER;
  const from = cur !== null && cur > now ? cur : now;
  return new Date(from + days * 86_400_000);
}

/** Wiersz premium_keys → lista w Administracji. */
export function keyView(r) {
  return {
    key: r.code,
    days: r.days,
    note: r.note,
    createdAt: new Date(r.created_at).getTime(),
    usedAt: r.used_at ? new Date(r.used_at).getTime() : null,
    usedBy: r.used_email ?? null,
  };
}
