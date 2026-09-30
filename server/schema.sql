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
