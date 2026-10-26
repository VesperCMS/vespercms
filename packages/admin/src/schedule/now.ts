import { useEffect, useState } from 'react';

/**
 * The time, again each minute, so words that depend on it ("Scheduled ·
 * …") change on their own once a time passes, and a render stays pure.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
