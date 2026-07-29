import type { ReactNode } from "react";

interface PanelProps {
  index: string;
  title: string;
  status?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}

/** Instrument-style container: index, title, rule, and an optional status readout. */
export function Panel({ index, title, status, flush, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__index">{index}</span>
        <h2 className="panel__title">{title}</h2>
        <span className="panel__fill" aria-hidden="true" />
        {status ? <span className="panel__status">{status}</span> : null}
      </header>
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>{children}</div>
    </section>
  );
}

interface ReadoutProps {
  label: string;
  value: ReactNode;
  dim?: boolean;
}

export function Readout({ label, value, dim }: ReadoutProps) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className={dim ? "readout__value readout__value--dim" : "readout__value"}>{value}</span>
    </div>
  );
}
