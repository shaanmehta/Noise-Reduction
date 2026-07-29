import { useCallback, useEffect, useRef, useState } from "react";

export type Side = "a" | "b";

interface AbPlayer {
  playing: boolean;
  position: number;
  duration: number;
  side: Side;
  ready: boolean;
  toggle: () => void;
  selectSide: (side: Side) => void;
  seek: (seconds: number) => void;
}

/**
 * Playback of the source and processed audio, one at a time.
 *
 * Both files are kept loaded so switching is quick, but only the selected one
 * is ever playing: the other is paused, not merely silenced. Running both at
 * once and muting one is a common trick for instant comparison, and it is
 * exactly what made the processed track audible twice over, so the inactive
 * element is now stopped outright. Switching carries the playhead across, so
 * you still hear the same moment of the recording either way.
 */
export function useAbPlayer(sourceUrl: string | null, processedUrl: string | null): AbPlayer {
  const sourceRef = useRef<HTMLAudioElement | null>(null);
  const processedRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number>(0);
  const sideRef = useRef<Side>("b");

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [side, setSide] = useState<Side>("b");
  const [ready, setReady] = useState(false);

  if (sourceRef.current === null && typeof Audio !== "undefined") {
    sourceRef.current = new Audio();
    processedRef.current = new Audio();
    for (const element of [sourceRef.current, processedRef.current]) {
      element.preload = "auto";
    }
  }

  /** The element the listener should be hearing right now. */
  const active = useCallback(
    () => (sideRef.current === "a" ? sourceRef.current : processedRef.current),
    [],
  );
  const inactive = useCallback(
    () => (sideRef.current === "a" ? processedRef.current : sourceRef.current),
    [],
  );

  useEffect(() => {
    sideRef.current = side;
  }, [side]);

  // Load the source track. Changing it resets the transport entirely.
  useEffect(() => {
    const element = sourceRef.current;
    if (!element) return;
    setPlaying(false);
    setPosition(0);
    setReady(false);
    element.pause();
    processedRef.current?.pause();
    if (!sourceUrl) {
      element.removeAttribute("src");
      element.load();
      return;
    }
    element.src = sourceUrl;
    element.load();

    const onLoaded = () => {
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setReady(true);
    };
    element.addEventListener("loadedmetadata", onLoaded);
    return () => element.removeEventListener("loadedmetadata", onLoaded);
  }, [sourceUrl]);

  // Load each new processed render, restoring position and playback state so
  // that moving a slider does not interrupt listening.
  useEffect(() => {
    const element = processedRef.current;
    const source = sourceRef.current;
    if (!element || !source) return;
    if (!processedUrl) {
      element.pause();
      element.removeAttribute("src");
      return;
    }

    const resumeAt = source.currentTime;
    const wasPlaying = sideRef.current === "b" && !element.paused;
    element.pause();
    element.src = processedUrl;
    element.load();

    const onReady = () => {
      try {
        element.currentTime = Math.min(resumeAt, element.duration || resumeAt);
      } catch {
        // Seeking before the buffer is ready is not fatal; playback still starts.
      }
      if (wasPlaying) void element.play().catch(() => undefined);
    };
    element.addEventListener("canplay", onReady, { once: true });
    return () => element.removeEventListener("canplay", onReady);
  }, [processedUrl]);

  // Both elements stay at full volume. Silence comes from being paused, which
  // is the only state that guarantees a track cannot be heard.
  useEffect(() => {
    if (sourceRef.current) sourceRef.current.volume = 1;
    if (processedRef.current) processedRef.current.volume = 1;
  }, []);

  // Drive the playhead from whichever element is actually playing.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(frameRef.current);
      return;
    }
    const step = () => {
      const element = active();
      if (element) setPosition(element.currentTime);
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing, active]);

  // Animation frames are suspended while the tab is in the background, so the
  // elements' own progress events keep the position honest.
  useEffect(() => {
    const elements = [sourceRef.current, processedRef.current].filter(Boolean) as HTMLAudioElement[];
    const onTimeUpdate = (event: Event) => {
      if (event.target === active()) setPosition((event.target as HTMLAudioElement).currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
      for (const element of elements) {
        element.pause();
        try {
          element.currentTime = 0;
        } catch {
          // Ignored: the element resets on its next load regardless.
        }
      }
    };
    for (const element of elements) {
      element.addEventListener("timeupdate", onTimeUpdate);
      element.addEventListener("ended", onEnded);
    }
    return () => {
      for (const element of elements) {
        element.removeEventListener("timeupdate", onTimeUpdate);
        element.removeEventListener("ended", onEnded);
      }
    };
  }, [active]);

  useEffect(() => {
    const elements = [sourceRef.current, processedRef.current];
    return () => {
      for (const element of elements) {
        element?.pause();
        element?.removeAttribute("src");
      }
    };
  }, []);

  const toggle = useCallback(() => {
    const current = active();
    const other = inactive();
    if (!current || !current.src) return;
    other?.pause();

    if (current.paused) {
      void current
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      current.pause();
      setPlaying(false);
    }
  }, [active, inactive]);

  const seek = useCallback((seconds: number) => {
    const elements = [sourceRef.current, processedRef.current].filter(Boolean) as HTMLAudioElement[];
    for (const element of elements) {
      if (!element.src) continue;
      const target = Math.max(0, Math.min(seconds, element.duration || seconds));
      try {
        element.currentTime = target;
      } catch {
        // Ignored: seeking before metadata arrives is a no-op, not a failure.
      }
    }
    setPosition(Math.max(0, seconds));
  }, []);

  const selectSide = useCallback(
    (next: Side) => {
      const previous = active();
      sideRef.current = next;
      setSide(next);

      const upcoming = next === "a" ? sourceRef.current : processedRef.current;
      if (!previous || !upcoming) return;

      // Hand the playhead over, then swap which element is running so that
      // exactly one is ever producing sound.
      const at = previous.currentTime;
      const wasPlaying = !previous.paused;
      previous.pause();
      try {
        upcoming.currentTime = Math.min(at, upcoming.duration || at);
      } catch {
        // Ignored, as above.
      }
      if (wasPlaying && upcoming.src) {
        void upcoming
          .play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      }
    },
    [active],
  );

  return { playing, position, duration, side, ready, toggle, selectSide, seek };
}
