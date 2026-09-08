import { useCallback, useEffect, useState } from "react";
import { TRADES_EVENT, readTrades, writeTrades } from "./trades.js";

/**
 * Local-only trade journal. Mirrors useWatchlist: one open trade per symbol,
 * cross-component sync via a custom DOM event, best-effort persistence.
 */
export default function useTradeJournal() {
  const [trades, setTrades] = useState(readTrades);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onChange() {
      setTrades(readTrades());
    }
    window.addEventListener(TRADES_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(TRADES_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const has = useCallback(
    (symbol) => (symbol ? trades.some((t) => t.symbol === symbol) : false),
    [trades],
  );

  const get = useCallback(
    (symbol) => (symbol ? trades.find((t) => t.symbol === symbol) || null : null),
    [trades],
  );

  const add = useCallback((trade) => {
    if (!trade || !trade.symbol) return;
    const current = readTrades();
    const next = [...current.filter((t) => t.symbol !== trade.symbol), trade];
    writeTrades(next);
    setTrades(next);
  }, []);

  const update = useCallback((symbol, patch) => {
    if (!symbol) return;
    const current = readTrades();
    const next = current.map((t) => (t.symbol === symbol ? { ...t, ...patch } : t));
    writeTrades(next);
    setTrades(next);
  }, []);

  const remove = useCallback((symbol) => {
    const current = readTrades();
    const next = current.filter((t) => t.symbol !== symbol);
    writeTrades(next);
    setTrades(next);
  }, []);

  return { trades, has, get, add, update, remove };
}
