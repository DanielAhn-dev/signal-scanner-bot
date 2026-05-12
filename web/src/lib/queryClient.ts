import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30초 stale
      gcTime: 5 * 60_000,        // 5분 GC
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
