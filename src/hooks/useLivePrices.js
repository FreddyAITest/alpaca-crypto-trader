import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLivePrices } from '../api';

/**
 * Custom hook for real-time price data with flash animations.
 * Polls /api/live-prices every 5 seconds and tracks price changes.
 * 
 * @param {number} intervalMs - Polling interval in milliseconds (default 5000)
 * @returns {{ prices, loading, error, connectionStatus, flashState, priceHistory, refresh }}
 */
export function useLivePrices(intervalMs = 5000) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [flashState, setFlashState] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const prevPricesRef = useRef({});
  const lastSuccessRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLivePrices();
      const newPrices = data.prices || {};
      
      // Detect price changes and trigger flash animation
      const newFlash = {};
      for (const [symbol, info] of Object.entries(newPrices)) {
        const prevPrice = prevPricesRef.current[symbol];
        if (prevPrice != null && info.price !== prevPrice) {
          newFlash[symbol] = info.price > prevPrice ? 'up' : 'down';
        }
      }
      
      if (Object.keys(newFlash).length > 0) {
        setFlashState(newFlash);
        setTimeout(() => setFlashState({}), 500);
      }
      
      // Store previous prices for comparison
      const prevMap = {};
      for (const [symbol, info] of Object.entries(newPrices)) {
        prevMap[symbol] = info.price;
      }
      prevPricesRef.current = prevMap;
      
      // Update price history for sparklines
      setPriceHistory(prev => {
        const next = { ...prev };
        for (const [symbol, info] of Object.entries(newPrices)) {
          if (!next[symbol]) next[symbol] = [];
          next[symbol] = [...next[symbol].slice(-19), info.price];
        }
        return next;
      });
      
      setPrices(newPrices);
      setConnectionStatus('live');
      setError(null);
      lastSuccessRef.current = Date.now();
    } catch (e) {
      setError(e.message);
      setConnectionStatus(prevPricesRef.current && Object.keys(prevPricesRef.current).length > 0 ? 'stale' : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, intervalMs);
    
    // Stale detection: mark as stale if no successful update in 15s
    const staleCheck = setInterval(() => {
      if (lastSuccessRef.current && Date.now() - lastSuccessRef.current > 15000) {
        setConnectionStatus('stale');
      }
    }, 5000);
    
    return () => {
      clearInterval(interval);
      clearInterval(staleCheck);
    };
  }, [refresh, intervalMs]);

  return { prices, loading, error, connectionStatus, flashState, priceHistory, refresh };
}

export default useLivePrices;