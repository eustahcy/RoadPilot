import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { NavPlace } from "../nav";

/** 2 = jest parking dla ciężarówek, 1 = ograniczony, 0 = brak (server/parking.mjs). */
type ParkingStatus = 0 | 1 | 2;

interface Opinion {
  id: number;
  status: ParkingStatus;
  note: string;
  label: string;
  distanceM: number;
  at: number;
  up: number;
  down: number;
  myVote: number;
  mine: boolean;
}

interface ParkingInfo {
  items: Opinion[];
  summary: { yes: number; limited: number; no: number };
}

const STATUS: { id: ParkingStatus; label: string; cls: string }[] = [
  { id: 2, label: "Jest parking", cls: "ok-text" },
  { id: 1, label: "Ograniczony", cls: "warn-text" },
  { id: 0, label: "Brak parkingu", cls: "bad-text" },
];

/** „dziś”, „wczoraj”, „5 dni temu”, „3 mies. temu”. */
function age(t: number) {
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "dziś";
  if (d === 1) return "wczoraj";
  if (d < 60) return `${d} dni temu`;
  return `${Math.round(d / 30)} mies. temu`;
}

/** Parking przy celu nawigacji: opinie kierowców (w promieniu ~300 m), potwierdzenia 👍/👎 i własna opinia. */
export function ParkingCard({ dest, token }: { dest: NavPlace; token: string }) {
  const [info, setInfo] = useState<ParkingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [status, setStatus] = useState<ParkingStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const q = `lat=${dest.lat}&lon=${dest.lon}`;
  const load = () => api<ParkingInfo>("GET", `/parking?${q}`, undefined, token).then(setInfo, (e) => setError(message(e)));

  useEffect(() => {
    setInfo(null);
    setForm(false);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest.lat, dest.lon, token]);

  const mine = info?.items.find((o) => o.mine);

  const openForm = () => {
    setStatus(mine?.status ?? null);
    setNote(mine?.note ?? "");
    setForm(true);
  };

  const save = async () => {
    if (status === null) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await api<ParkingInfo>("POST", "/parking", { lat: dest.lat, lon: dest.lon, label: dest.label, status, note }, token));
      setForm(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const vote = async (o: Opinion, v: number) => {
    const next = o.myVote === v ? 0 : v;
    setError(null);
    try {
      await api("POST", "/parking/vote", { id: o.id, vote: next }, token);
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async (o: Opinion) => {
    setError(null);
    try {
      await api("DELETE", "/parking", { id: o.id }, token);
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  const s = info?.summary;
  const total = s ? s.yes + s.limited + s.no : 0;

  return (
    <div className="dest-parking">
      <div className="stop-label">Parking przy celu · opinie kierowców</div>
      {!info && !error && <p className="muted small">Sprawdzam…</p>}
      {info && (total ? (
        <p className="parking-summary">
          {s!.yes > 0 && <span className="ok-text">Jest parking: {s!.yes}</span>}
          {s!.limited > 0 && <span className="warn-text">Ograniczony: {s!.limited}</span>}
          {s!.no > 0 && <span className="bad-text">Brak: {s!.no}</span>}
        </p>
      ) : (
        <p className="muted small">Nikt jeszcze nie ocenił parkingu przy tym celu. Byłeś tu? Daj znać innym.</p>
      ))}

      {info && info.items.length > 0 && (
        <ul className="parking-list">
          {info.items.slice(0, 6).map((o) => {
            const st = STATUS.find((x) => x.id === o.status)!;
            return (
              <li key={o.id} className={o.down > o.up ? "disputed" : ""}>
                <div>
                  <b className={st.cls}>{st.label}</b>
                  <small className="muted"> · {age(o.at)}{o.distanceM > 60 ? ` · ${o.distanceM} m od celu` : ""}{o.mine ? " · Twoja opinia" : ""}</small>
                  {o.note && <p>{o.note}</p>}
                </div>
                {o.mine ? (
                  <button className="text-btn" onClick={() => remove(o)}>Usuń</button>
                ) : (
                  <span className="parking-votes">
                    <button className={`ghost ${o.myVote === 1 ? "active" : ""}`} aria-pressed={o.myVote === 1} aria-label="Potwierdzam" onClick={() => vote(o, 1)}>👍 {o.up}</button>
                    <button className={`ghost ${o.myVote === -1 ? "active" : ""}`} aria-pressed={o.myVote === -1} aria-label="Nieaktualne" onClick={() => vote(o, -1)}>👎 {o.down}</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form ? (
        <div className="parking-form">
          <div className="parking-status">
            {STATUS.map((x) => (
              <button key={x.id} className={`profile ${status === x.id ? "active" : ""}`} aria-pressed={status === x.id} onClick={() => setStatus(x.id)}>
                <strong>{x.label}</strong>
              </button>
            ))}
          </div>
          <label className="field wide">
            <span className="field-label">Komentarz (opcjonalnie)</span>
            <input type="text" maxLength={280} value={note} placeholder="np. plac za bramą na 5 aut, nocleg tylko do 6:00" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row-buttons">
            <button className="primary" disabled={status === null || busy} onClick={save}>{busy ? "Zapisuję…" : "Zapisz opinię"}</button>
            <button className="ghost" onClick={() => setForm(false)}>Anuluj</button>
          </div>
        </div>
      ) : (
        info && <button className="ghost" onClick={openForm}>{mine ? "Zmień swoją opinię" : "Dodaj opinię o parkingu"}</button>
      )}
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}

function message(e: unknown) {
  if (e instanceof ApiError && e.status === 0) return "Brak internetu — opinie o parkingu wymagają połączenia.";
  return e instanceof Error ? e.message : "Coś poszło nie tak.";
}
