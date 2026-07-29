import type { ReactNode } from "react";

interface PanelProps {
  index: string;
  title: string;
  status?: ReactNode;
  flush?: boolean;
  /** Highlights the step the visitor should act on next. */
  active?: boolean;
  children: ReactNode;
}

/**
 * A numbered step. The number sits in a badge rather than running inline with
 * the title, so the sequence through the page is readable at a glance.
 */
export function Panel({ index, title, status, flush, active, children }: PanelProps) {
  return (
    <section className={`panel${active ? " panel--active" : ""}`}>
      <header className="panel__header">
        <span className="panel__index" aria-hidden="true">
          {index}
        </span>
        <h2 className="panel__title">
          <span className="visually-hidden">{`Step ${Number(index)}: `}</span>
          {title}
        </h2>
        <span className="panel__fill" aria-hidden="true" />
        {status ? <span className="panel__status">{status}</span> : null}
      </header>
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>{children}</div>
    </section>
  );
}
