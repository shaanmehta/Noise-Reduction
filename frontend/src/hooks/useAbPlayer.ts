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
 * Synchronised A/B playback of the source and processed audio.
 *
 * Both elements play at once and the inactive one is silenced, which is how
 * comparison works on a mixing desk: switching is instantaneous and the two
 * versions stay locked to the same instant of the recording. Switching by
 * pausing and seeking would introduce a gap exactly where the listener is
 * trying to hear a difference.
 */
export function useAbPlayer(sourceUrl: string | null, processedUrl: string | null): AbPlayer {
  const sourceRef = useRef<HTMLAudioElement | null>(null);
  const processedRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number>(0);

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

  // Load the source track. Changing it resets the transport entirely.
  useEffect(() => {
    const element = sourceRef.current;
    if (!element) return;
    setPlaying(false);
    setPosition(0);
    setReady(false);
    element.pause();
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
    const wasPlaying = !source.paused;
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

  // Only the selected side is audible.
  useEffect(() => {
    if (sourceRef.current) sourceRef.current.volume = side === "a" ? 1 : 0;
    if (processedRef.current) processedRef.current.volume = side === "b" ? 1 : 0;
  }, [side, processedUrl]);

  // Drive the playhead from the source element, which is always loaded.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(frameRef.current);
      return;
    }
    const step = () => {
      const element = sourceRef.current;
      if (element) {
        setPosition(element.currentTime);
        if (element.ended) {
          setPlaying(false);
          setPosition(0);
          return;
        }
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
      source.currentTime = 0;
      if (processedRef.current) processedRef.current.currentTime = 0;
    };
    // Animation frames are suspended while the tab is in the background, so
    // the element's own progress events keep the position honest. They fire
    // a few times a second, which is coarse for a playhead but correct.
    const onTimeUpdate = () => setPosition(source.currentTime);
    source.addEventListener("ended", onEnded);
    source.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      source.removeEventListener("ended", onEnded);
      source.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

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
    const source = sourceRef.current;
    const processed = processedRef.current;
    if (!source) return;
    if (source.paused) {
      // Realign before starting so drift from a previous render cannot persist.
      if (processed && processed.src) {
        try {
          processed.currentTime = source.currentTime;
        } catch {
          // Ignored: playback continues from wherever the element is ready.
        }
        void processed.play().catch(() => undefined);
      }
      void source
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      source.pause();
      processed?.pause();
      setPlaying(false);
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const source = sourceRef.current;
    const processed = processedRef.current;
    if (!source) return;
    const target = Math.max(0, Math.min(seconds, source.duration || seconds));
    source.currentTime = target;
    if (processed && processed.src) {
      try {
        processed.currentTime = Math.min(target, processed.duration || target);
      } catch {
        // Ignored, as above.
      }
    }
    setPosition(target);
  }, []);

  const selectSide = useCallback((next: Side) => {
    const source = sourceRef.current;
    const processed = processedRef.current;
    // Re-sync on every switch: a long session can accumulate drift between
    // two independently scheduled media elements.
    if (source && processed && processed.src) {
      try {
        processed.currentTime = source.currentTime;
      } catch {
        // Ignored.
      }
    }
    setSide(next);
  }, []);

  return { playing, position, duration, side, ready, toggle, selectSide, seek };
}
