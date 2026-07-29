import { useEffect, useRef, useState } from "react";

/**
 * Delays a value until it stops changing.
 *
 * Slider movement produces a value on every frame; the network does not need
 * to see them all. The first change is allowed through immediately so the
 * first nudge feels instant, and the rest are held until movement settles.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  const initial = useRef(true);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      setSettled(value);
      return;
    }
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
