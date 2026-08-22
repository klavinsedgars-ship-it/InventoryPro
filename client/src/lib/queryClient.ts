import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Invalidate every query that shows product data, by PREFIX MATCH on the key
 * string. Use this instead of invalidateQueries({queryKey: ["/api/products"]}):
 * that form only matches keys whose first array element is exactly
 * "/api/products", silently missing the Products page's real key
 * "/api/products/paged?…" — with the app-wide staleTime: Infinity, every such
 * mutation left the table permanently stale (delete/list/edit/sync all looked
 * like no-ops until a hard reload).
 */
export function invalidateProductViews() {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return (
        k.startsWith("/api/products") ||
        k.startsWith("/api/dashboard") ||
        k.startsWith("/api/stock")
      );
    },
  });
}
