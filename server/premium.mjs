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

/**
 * Klucz licencyjny wymyślony przez administratora („LATO2026”, „Firma-Kowalski”) albo wygenerowany → postać do porównań:
 * wielkie litery, bez spacji, myślników, podkreśleń i kropek. null = za krótki / niedozwolone znaki.
 */
export function canonKey(input) {
  const c = String(input ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
  return /^[A-Z0-9ĄĆĘŁŃÓŚŹŻ]{4,40}$/.test(c) ? c : null;
}

/**
 * Czy konto może użyć klucza: tylko dla wskazanego konta (for_user), limit użyć (max_uses, null = bez limitu),
 * jedno użycie na konto. Zwraca null (można) albo komunikat dla kierowcy.
 */
/** Nowy klucz można użyć dopiero tyle dni przed końcem trwającej licencji (licencje się nie kumulują). */
export const RENEW_BEFORE_DAYS = 5;

export function redeemProblem(key, userId, usedCount, usedByMe, premiumUntil = null, now = Date.now()) {
  if (!key) return "Nie ma takiego klucza — sprawdź, czy dobrze przepisany.";
  const until = premiumUntil ? new Date(premiumUntil).getTime() : null;
  if (until !== null && until >= FOREVER.getTime()) return "Masz licencję bez terminu — nowy klucz nie jest potrzebny.";
  if (until !== null && until - now > RENEW_BEFORE_DAYS * 86_400_000) {
    const from = new Date(until - RENEW_BEFORE_DAYS * 86_400_000).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" });
    return `Licencja jest aktywna do ${new Date(until).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" })}. Nowy klucz możesz wpisać od ${from} (${RENEW_BEFORE_DAYS} dni przed końcem).`;
  }
  if (key.for_user !== null && key.for_user !== undefined && Number(key.for_user) !== Number(userId)) return "Ten klucz jest przypisany do innego konta.";
  if (usedByMe) return "Ten klucz został już użyty na Twoim koncie.";
  if (key.max_uses !== null && key.max_uses !== undefined && usedCount >= key.max_uses) return key.max_uses === 1 ? "Ten klucz został już użyty." : "Limit użyć tego klucza się wyczerpał.";
  return null;
}

/** Wiersz premium_keys (+ liczba użyć, e-mail przypisanego konta, kto użył) → lista w Administracji. */
export function keyView(r) {
  return {
    key: r.label || r.code,
    code: r.code,
    days: r.days,
    note: r.note,
    forEmail: r.for_email ?? null,
    maxUses: r.max_uses ?? null,
    uses: Number(r.uses ?? 0),
    createdAt: new Date(r.created_at).getTime(),
    lastUsedAt: r.last_used ? new Date(r.last_used).getTime() : null,
    usedBy: r.used_emails ? String(r.used_emails).split(",").slice(0, 5) : [],
  };
}
