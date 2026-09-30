import { ReactNode, useEffect, useState } from "react";

/** Pole liczbowe, które pozwala chwilowo wyczyścić wartość podczas pisania. */
export function NumberField(props: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  wide?: boolean;
}) {
  const { label, value, onChange, unit, min, max, step = 1, wide } = props;
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text.replace(",", ".")) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    setText(raw);
    const n = Number(raw.replace(",", "."));
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
  };
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="input-row">
        <input type="text" inputMode="decimal" value={text} onChange={(e) => commit(e.target.value)} onBlur={() => setText(String(value))} step={step} />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

/** Pole liczbowe, które można zostawić puste (null = „nie ustawiono”). */
export function OptionalNumberField(props: { label: ReactNode; value: number | null; onChange: (v: number | null) => void; unit?: string; placeholder?: string; hint?: ReactNode; max?: number }) {
  const { label, value, onChange, unit, placeholder, hint, max } = props;
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const n = text.trim() === "" ? null : Number(text.replace(/\s/g, "").replace(",", "."));
    if (n !== value) setText(value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") return onChange(null);
    const n = Number(raw.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) onChange(clamp(n, 0, max));
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-row">
        <input type="text" inputMode="numeric" value={text} placeholder={placeholder} onChange={(e) => commit(e.target.value)} />
        {unit && <span className="unit">{unit}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Czas w godzinach i minutach, jak na wyświetlaczu tachografu. Wartość w minutach. */
export function DurationField(props: { label: ReactNode; value: number; onChange: (min: number) => void; maxHours?: number; hint?: ReactNode }) {
  const { label, value, onChange, maxHours = 99, hint } = props;
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  const set = (hh: number, mm: number) => onChange(clamp(hh, 0, maxHours) * 60 + clamp(mm, 0, 59));
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="duration">
        <span className="input-row">
          <input type="number" inputMode="numeric" min={0} max={maxHours} value={h} onChange={(e) => set(Number(e.target.value) || 0, m)} aria-label="godziny" />
          <span className="unit">h</span>
        </span>
        <span className="input-row">
          <input type="number" inputMode="numeric" min={0} max={59} value={m} onChange={(e) => set(h, Number(e.target.value) || 0)} aria-label="minuty" />
          <span className="unit">min</span>
        </span>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`toggle ${props.disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
      <span>
        <span className="toggle-label">{props.label}</span>
        {props.hint && <span className="field-hint">{props.hint}</span>}
      </span>
    </label>
  );
}

export function Stepper(props: { label: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; hint?: ReactNode }) {
  const { label, value, onChange, min, max, hint } = props;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="mniej">−</button>
        <strong>{value}</strong>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="więcej">+</button>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function clamp(n: number, min = -Infinity, max = Infinity) {
  return Math.max(min, Math.min(max, n));
}
