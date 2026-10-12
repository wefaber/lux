import { useState, useEffect } from "react";
import { errorMessage } from "@/lib/utils";

export function useSkeleton(delay = 200): boolean {
  const [showing, setShowing] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowing(false), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return showing;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; isLoading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, "Error desconocido"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, ...deps]);

  const refetch = () => setTrigger((t) => t + 1);

  return { data, isLoading, error, refetch };
}
