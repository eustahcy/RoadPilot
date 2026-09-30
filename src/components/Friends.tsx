import { FormEvent, useState } from "react";
import { describeFriend, Friend, nearestFriend } from "../core/friends";
import { fmtClock, fmtKm } from "../format";
import { FriendsApi } from "../friends";
import { Toggle } from "./fields";

interface CardProps {
  api: FriendsApi;
  me: { lat: number; lon: number } | null;
  now: number;
  onManage: () => void;
}

/** Karta na Planie: znajomi z sygnałem (odległość, status, od kiedy, cel) i zaproszenia do akceptacji. */
export function FriendsCard({ api, me, now, onManage }: CardProps) {
  const accepted = api.friends.filter((f) => f.relation === "accepted");
  const pending = api.friends.filter((f) => f.relation === "pending");
  if (!accepted.length && !pending.length) return null;
  // Z sygnałem najpierw, najbliżsi na górze; bez sygnału na końcu.
  const rows = accepted
    .map((f) => ({ f, info: f.presence ? describeFriend(f.presence, me, now) : undefined }))
    .sort((a, b) => (a.info?.km ?? Infinity) - (b.info?.km ?? Infinity) || Number(!a.info) - Number(!b.info));
  return (
    <section className="card">
      <button className="section-head" onClick={onManage}>
        <span>
          <span className="eyebrow">Znajomi</span>
          <h2>Kto gdzie jedzie</h2>
        </span>
        <span className="link">Zarządzaj</span>
      </button>
      {pending.map((f) => (
        <div className="hint" key={f.id}>
          <span><strong>{f.name}</strong> ({f.email}) chce Cię dodać do znajomych.</span>
          <button className="ghost" onClick={() => api.accept(f.id)}>Akceptuj</button>
        </div>
      ))}
      <ul className="friends">
        {rows.map(({ f, info }) => (
          <li key={f.id} className={`friend ${info?.tone ?? ""} ${info ? "" : "offline"}`}>
            <span className="friend-avatar" aria-hidden>{f.name.charAt(0).toUpperCase()}</span>
            <span className="friend-body">
              <b>{f.name}</b>
              {info && f.presence ? (
                <>
                  <span className="friend-status">
                    <strong>{info.status}</strong>
                    {f.presence.kmh !== null && f.presence.status === "driving" ? ` · ${f.presence.kmh} km/h` : ""}
                    {info.duration ? ` · ${info.duration}` : ""}
                  </span>
                  <span className="muted small">
                    {f.presence.dest ? `→ ${f.presence.dest}` : "bez celu"}
                    {f.presence.leftKm !== null && f.presence.dest ? ` · ${fmtKm(f.presence.leftKm)}` : ""}
                    {f.presence.arrival !== null && f.presence.dest ? ` · przyjazd ${fmtClock(f.presence.arrival, now)}` : ""}
                    {f.presence.driveLeftMin !== null ? ` · jazda zostało ${fmtMin(f.presence.driveLeftMin)}` : ""}
                  </span>
                </>
              ) : (
                <span className="muted small">brak sygnału — aplikacja zamknięta albo GPS wyłączony</span>
              )}
            </span>
            <span className="friend-km">{info?.km !== undefined ? <><strong>{fmtKm(info.km)}</strong><small>od Ciebie</small></> : null}</span>
          </li>
        ))}
      </ul>
      {api.stale && <p className="muted small">Brak sieci — dane mogą być nieaktualne.</p>}
    </section>
  );
}

const fmtMin = (min: number) => (min <= 0 ? "0 min" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`);

interface SettingsProps {
  api: FriendsApi | null;
  share: boolean;
  onShare: (on: boolean) => void;
  gpsOn: boolean;
  onLogin: () => void;
}

/** Ustawienia → Znajomi: zaproszenie po e-mailu, lista, akceptacja i usuwanie, przełącznik udostępniania. */
export function FriendsSettings({ api, share, onShare, gpsOn, onLogin }: SettingsProps) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api) {
    return (
      <section className="card">
        <div className="eyebrow">Znajomi</div>
        <h2>Jedźcie razem</h2>
        <p className="muted">Zobacz, gdzie są koledzy z trasy: odległość od Ciebie, czy jadą, czy mają pauzę i dokąd jadą. Wymaga konta — Twojego i znajomego.</p>
        <button className="primary" onClick={onLogin}>Zaloguj się lub załóż konto</button>
      </section>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const rel = await api.invite(email.trim());
      setMsg({ kind: "ok", text: rel === "accepted" ? "Jesteście znajomymi — zaproszenie z drugiej strony już czekało." : "Zaproszenie wysłane. Znajomy zobaczy je w RoadPilot i musi je zaakceptować." });
      setEmail("");
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Nie udało się wysłać zaproszenia." });
    } finally {
      setBusy(false);
    }
  };
  const groups: { title: string; items: Friend[]; action: (f: Friend) => React.ReactNode }[] = [
    { title: "Zaproszenia dla Ciebie", items: api.friends.filter((f) => f.relation === "pending"), action: (f) => <><button className="primary pick" onClick={() => api.accept(f.id)}>Akceptuj</button><button className="ghost" onClick={() => api.remove(f.id)}>Odrzuć</button></> },
    { title: "Znajomi", items: api.friends.filter((f) => f.relation === "accepted"), action: (f) => <button className="ghost" onClick={() => confirm(`Usunąć ${f.name} ze znajomych? Przestaniecie się widzieć.`) && api.remove(f.id)}>Usuń</button> },
    { title: "Wysłane zaproszenia", items: api.friends.filter((f) => f.relation === "invited"), action: (f) => <button className="ghost" onClick={() => api.remove(f.id)}>Wycofaj</button> },
  ];
  return (
    <>
      <section className="card">
        <div className="eyebrow">Znajomi</div>
        <h2>Dodaj znajomego</h2>
        <p className="muted small">Podaj e-mail konta RoadPilot znajomego. Zobaczycie się dopiero, gdy zaakceptuje zaproszenie.</p>
        <form className="inline" onSubmit={submit}>
          <input type="email" required value={email} placeholder="kolega@firma.pl" autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          <button className="primary" disabled={busy || !email.trim()}>Zaproś</button>
        </form>
        {msg && <p className={`muted small ${msg.kind === "err" ? "warn-text" : ""}`}>{msg.text}</p>}
      </section>

      {groups.filter((g) => g.items.length).map((g) => (
        <section className="card" key={g.title}>
          <div className="eyebrow">{g.title}</div>
          <ul className="friends manage">
            {g.items.map((f) => (
              <li key={f.id} className="friend">
                <span className="friend-avatar" aria-hidden>{f.name.charAt(0).toUpperCase()}</span>
                <span className="friend-body"><b>{f.name}</b><span className="muted small">{f.email}</span></span>
                <span className="row-buttons">{g.action(f)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card">
        <div className="eyebrow">Prywatność</div>
        <Toggle checked={share} onChange={onShare} label="Udostępniaj moją pozycję znajomym" hint={gpsOn ? "Pozycja, prędkość, postój (rodzaj i czas), cel z przyjazdem i stan tachografu — tylko dla zaakceptowanych znajomych, tylko gdy aplikacja jest otwarta." : "Wysyłka działa tylko przy włączonym GPS (zakładka Plan)."} />
        <p className="muted small">Po wyłączeniu znajomi od razu przestają Cię widzieć; serwer nie przechowuje historii pozycji — tylko ostatnią, kasowaną po wyłączeniu.</p>
      </section>
    </>
  );
}

/** Kafelek HUD (styl zwykły): najbliższy znajomy. */
export function FriendTile({ friends, me, now }: { friends: Friend[]; me: { lat: number; lon: number } | null; now: number }) {
  const n = nearestFriend(friends, me);
  const info = n?.friend.presence ? describeFriend(n.friend.presence, me, now) : undefined;
  return (
    <div className={`hud-info-tile is-friend ${info?.tone ?? ""}`}>
      <span className="hud-avatar" aria-hidden>{n ? n.friend.name.charAt(0).toUpperCase() : "?"}</span>
      <span className="hud-info-text">
        <small>{n ? n.friend.name : "Znajomi"}</small>
        <b className="ellipsis">{n && info ? `${info.km !== undefined ? fmtKm(info.km) : "—"} · ${info.status}` : "—"}</b>
        <span>{n && info && n.friend.presence ? [info.duration, n.friend.presence.dest ? `→ ${n.friend.presence.dest}` : ""].filter(Boolean).join(" · ") : "nikt nie nadaje"}</span>
      </span>
    </div>
  );
}
