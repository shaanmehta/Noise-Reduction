import { useEffect, useId, useRef, useState } from "react";

interface HelpTipProps {
  label: string;
  children: string;
}

/**
 * A question mark that reveals a one-line explanation.
 *
 * Click rather than hover, so it works on touch, and the panel closes on
 * Escape or an outside click like any other transient popover.
 */
export function HelpTip({ label, children }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const identifier = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="helptip" ref={wrapperRef}>
      <button
        type="button"
        className="helptip__button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-controls={identifier}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <span className="helptip__bubble" id={identifier} role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
