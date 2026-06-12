import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '../api';

/**
 * Cached GET against the API. Keyed by path, so any two components asking for
 * the same path share one request and one cache entry. Drop-in replacement for
 * the old useState + useEffect + setInterval pattern:
 *
 *   const { data: devices = [], refetch } = useApiQuery<any[]>('/api/devices', { refetchInterval: 30000 });
 */
export function useApiQuery<T = any>(
  path: string,
  opts: { refetchInterval?: number; enabled?: boolean } = {}
) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled: (opts.enabled ?? true) && !!getToken(),
    refetchInterval: opts.refetchInterval
  });
}
