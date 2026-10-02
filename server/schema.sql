-- RoadPilot — schemat bazy (MariaDB / MySQL). Uruchamiany przy starcie serwera (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesje: w bazie tylko skrót SHA-256 tokenu — wyciek bazy nie daje dostępu do kont.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stan aplikacji konta (AppState bez danych tylko dla urządzenia) — rev rośnie przy każdym zapisie.
CREATE TABLE IF NOT EXISTS user_state (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  state LONGTEXT NOT NULL,
  rev INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_state_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reset hasła: jednorazowy token z e-maila (w bazie tylko skrót SHA-256), ważny 1 h.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY (user_id),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Role i Premium (2026-09-30): admin może nadawać Premium; premium_until NULL = brak, data w przyszłości = aktywne.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until DATETIME NULL;

-- Zgoda na zbieranie danych do mapy RoadPilot (RODO: data zgody; NULL = brak).
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_consent_at DATETIME NULL;

-- Zużycie płatnych API (TomTom) w okresie rozliczeniowym — pilnujemy progu 80% limitu.
CREATE TABLE IF NOT EXISTS api_usage (
  api VARCHAR(20) NOT NULL,
  period VARCHAR(10) NOT NULL,
  count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (api, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ślady przejazdów (tylko za zgodą, tylko Polska) — podkładka pod własną mapę dróg dla ciężarówek.
CREATE TABLE IF NOT EXISTS gps_points (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  t DATETIME(3) NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  kmh SMALLINT NULL,
  heading SMALLINT NULL,
  KEY (user_id),
  KEY (t),
  CONSTRAINT fk_points_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Zgłoszenia kierowców: wiadukty, tonaż, prędkość, zakazy, zamknięcia, parkingi.
CREATE TABLE IF NOT EXISTS road_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind VARCHAR(20) NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  heading SMALLINT NULL,
  value DECIMAL(7,2) NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  KEY (user_id),
  KEY (kind),
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ograniczenia dla ciężarówek z OpenStreetMap (import: server/osm-import.mjs; dane © OpenStreetMap, ODbL).
CREATE TABLE IF NOT EXISTS osm_restrictions (
  osm_id VARCHAR(20) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  value DECIMAL(7,2) NULL,
  raw VARCHAR(60) NOT NULL DEFAULT '',
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  geom MEDIUMTEXT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  bridge TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (osm_id, kind),
  KEY (lat, lon),
  KEY (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Warunki z OSM (2026-10-01): godziny, dni, „nie dotyczy dojazdu” — JSON z conditional.mjs parseConditional.
ALTER TABLE osm_restrictions ADD COLUMN IF NOT EXISTS cond TEXT NULL;

-- Fotoradary, odcinkowe pomiary prędkości, kamery na czerwonym (OSM; import: server/enforcement-import.mjs).
-- from_* — skąd jedzie mierzony pojazd (kierunek; NULL = oba), to_* — koniec odcinka (tylko section).
CREATE TABLE IF NOT EXISTS osm_enforcement (
  osm_id VARCHAR(20) NOT NULL PRIMARY KEY,
  kind VARCHAR(12) NOT NULL,
  value SMALLINT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  from_lat DOUBLE NULL,
  from_lon DOUBLE NULL,
  to_lat DOUBLE NULL,
  to_lon DOUBLE NULL,
  ref VARCHAR(40) NOT NULL DEFAULT '',
  KEY (lat, lon)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Głosy kierowców po minięciu fotoradaru / kontroli: „nadal jest” (+1) / „nie ma” (-1). Jeden głos na miejsce na konto.
CREATE TABLE IF NOT EXISTS alert_votes (
  user_id INT UNSIGNED NOT NULL,
  source VARCHAR(8) NOT NULL,
  ref_id VARCHAR(20) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  vote TINYINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source, ref_id),
  KEY (source, ref_id),
  CONSTRAINT fk_votes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Znajomi (2026-09-30): zaproszenie po e-mailu, widoczność dopiero po akceptacji drugiej strony (accepted_at).
-- Jeden wiersz na parę: user_id = kto zaprosił, friend_id = zaproszony.
CREATE TABLE IF NOT EXISTS friends (
  user_id INT UNSIGNED NOT NULL,
  friend_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at DATETIME NULL,
  PRIMARY KEY (user_id, friend_id),
  KEY (friend_id),
  CONSTRAINT fk_friends_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friends_friend FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Obecność dla znajomych: ostatnia pozycja, prędkość, postój, cel i stan tachografu (JSON, patrz friends.mjs cleanPresence).
-- Jeden wiersz na konto, nadpisywany; wyłączenie udostępniania kasuje wiersz. Starsze niż PRESENCE_TTL = „brak sygnału”.
CREATE TABLE IF NOT EXISTS presence (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_presence_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Parking przy celu (2026-09-30): opinie kierowców „czy da się stanąć koło firmy” (status 2 = jest dla ciężarówek,
-- 1 = ograniczony, 0 = brak) i potwierdzenia innych. Jedna opinia na kierowcę w promieniu celu (zmiana nadpisuje).
CREATE TABLE IF NOT EXISTS parking_opinions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  label VARCHAR(120) NOT NULL DEFAULT '',
  status TINYINT NOT NULL,
  note VARCHAR(280) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY (lat, lon),
  KEY (user_id, updated_at),
  CONSTRAINT fk_parking_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 👍 / 👎 pod opinią o parkingu — jeden głos na konto (zmiana nadpisuje, 0 = wycofanie).
CREATE TABLE IF NOT EXISTS parking_votes (
  user_id INT UNSIGNED NOT NULL,
  opinion_id INT UNSIGNED NOT NULL,
  vote TINYINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, opinion_id),
  KEY (opinion_id),
  CONSTRAINT fk_pvotes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_pvotes_opinion FOREIGN KEY (opinion_id) REFERENCES parking_opinions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pinezki przy trasie (2026-09-30): stacje paliw, MOP-y i parkingi dla ciężarówek z OSM (import: server/poi-import.mjs).
CREATE TABLE IF NOT EXISTS osm_pois (
  osm_id VARCHAR(20) NOT NULL PRIMARY KEY,
  kind VARCHAR(10) NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  truck TINYINT NOT NULL DEFAULT 0,
  KEY (lat, lon)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Miejscowości (2026-10-01): do opisu miejsca przekroczenia w historii (import: server/place-import.mjs).
CREATE TABLE IF NOT EXISTS osm_places (
  osm_id VARCHAR(20) NOT NULL PRIMARY KEY,
  kind VARCHAR(10) NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  name VARCHAR(120) NOT NULL,
  KEY (lat, lon)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Klucze Premium (2026-10-01): admin generuje klucz na N dni (NULL = bez terminu), kierowca wpisuje go w Ustawienia → Konto.
CREATE TABLE IF NOT EXISTS premium_keys (
  code CHAR(12) NOT NULL PRIMARY KEY,
  days INT NULL,
  note VARCHAR(120) NOT NULL DEFAULT '',
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_by INT UNSIGNED NULL,
  used_at DATETIME NULL,
  KEY (created_at),
  CONSTRAINT fk_pkeys_used FOREIGN KEY (used_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prędkości ciężarówek z jazdy kierowców (2026-10-01): komórka ~250 m × kierunek (0–7), mediana przejazdów
-- (budowa: server/speed-build.mjs, co tydzień w scripts/weekly-update.sh).
CREATE TABLE IF NOT EXISTS speed_cells (
  cell VARCHAR(24) NOT NULL,
  dir TINYINT NOT NULL,
  passes INT NOT NULL,
  users INT NOT NULL,
  kmh SMALLINT NOT NULL,
  PRIMARY KEY (cell, dir)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Błędy mapy (2026-10-01): ograniczenia, przez które przejechali kierowcy z niespełniającym pojazdem (suspects-build.mjs),
-- i ograniczenia ukryte przez admina (nie wpływają na trasy ani ostrzeżenia).
CREATE TABLE IF NOT EXISTS map_suspects (
  osm_id VARCHAR(20) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  value DECIMAL(7,2) NULL,
  users INT NOT NULL,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (osm_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS osm_overrides (
  osm_id VARCHAR(20) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  hidden_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (osm_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ustawienia aplikacji zmieniane przez administratora (2026-10-02): np. link do wsparcia (Revolut) na stronie „Wsparcie”.
CREATE TABLE IF NOT EXISTS app_config (
  k VARCHAR(40) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Słupki kilometrowe z OSM (highway=milestone, distance = km drogi; 2026-10-02) — pikietaż w Nawigacji.
CREATE TABLE IF NOT EXISTS osm_milestones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lat DOUBLE NOT NULL,
  lon DOUBLE NOT NULL,
  km DECIMAL(7, 3) NOT NULL,
  ref VARCHAR(20) NOT NULL DEFAULT '',
  KEY (lat, lon)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Licencje (2026-10-02): klucz wymyślony przez administratora (code = postać kanoniczna, label = jak wpisał), dla konta (for_user)
-- albo dla wielu osób (max_uses, NULL = bez limitu), na N dni albo bez terminu. Użycia w premium_redemptions (1 na konto).
ALTER TABLE premium_keys MODIFY code VARCHAR(40) NOT NULL;
ALTER TABLE premium_keys ADD COLUMN IF NOT EXISTS label VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE premium_keys ADD COLUMN IF NOT EXISTS for_user INT UNSIGNED NULL;
ALTER TABLE premium_keys ADD COLUMN IF NOT EXISTS max_uses INT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS premium_redemptions (
  code VARCHAR(40) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code, user_id),
  KEY (user_id),
  CONSTRAINT fk_redeem_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Stare klucze RP-XXXX-XXXX: etykieta jak dotąd, kod bez myślników, dotychczasowe użycie jako wpis w premium_redemptions.
UPDATE premium_keys SET label = code WHERE label = '';
INSERT IGNORE INTO premium_redemptions (code, user_id, used_at) SELECT REPLACE(code, '-', ''), used_by, used_at FROM premium_keys WHERE used_by IS NOT NULL;
UPDATE premium_keys SET code = REPLACE(code, '-', '') WHERE code LIKE 'RP-%';
