import { useCallback, useEffect, useState } from "react";

const KEY = "nseSwingWatchlist";
const EVENT = "nseSwingWatchlistChange";

function readRaw() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRaw(symbols) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(symbols));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota / privacy mode — silently ignore, watchlist is best-effort */
  }
}

/**
 * Single-user watchlist persisted to localStorage. Cross-component
 * synchronisation uses a custom DOM event so multiple StarButtons on the
 * same page stay in lockstep without prop-drilling.
 */
export default function useWatchlist() {
  const [symbols, setSymbols] = useState(readRaw);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onChange() {
      setSymbols(readRaw());
    }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const has = useCallback(
    (symbol) => (symbol ? symbols.includes(symbol) : false),
    [symbols],
  );

  const toggle = useCallback((symbol) => {
    if (!symbol) return;
    const current = readRaw();
    const next = current.includes(symbol)
      ? current.filter((s) => s !== symbol)
      : [...current, symbol];
    writeRaw(next);
    setSymbols(next);
  }, []);

  const add = useCallback((symbol) => {
    if (!symbol) return;
    const current = readRaw();
    if (current.includes(symbol)) return;
    const next = [...current, symbol];
    writeRaw(next);
    setSymbols(next);
  }, []);

  const remove = useCallback((symbol) => {
    const current = readRaw();
    if (!current.includes(symbol)) return;
    const next = current.filter((s) => s !== symbol);
    writeRaw(next);
    setSymbols(next);
  }, []);

  return { symbols, has, toggle, add, remove };
}