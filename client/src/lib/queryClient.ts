import { QueryClient, QueryFunction } from "@tanstack/react-query";

const MAIN_DOMAIN = 'https://www.suibets.com';

function isWalrusDomain(): boolean {
  const hostname = window.location.hostname;
  return hostname.endsWith('.wal.app') || hostname.endsWith('.walrus.site');
}

export const API_BASE = import.meta.env.VITE_API_BASE_URL || (isWalrusDomain() ? MAIN_DOMAIN : '');

export function getMainDomainOrigin(): string {
  return isWalrusDomain() ? MAIN_DOMAIN : window.location.origin;
}

if (API_BASE) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(`${API_BASE}${input}`, init);
    }
    return originalFetch(input, init);
  };
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      // Try to parse the error as JSON first
      const data = await res.json();
      errorMessage = data.message || data.error || JSON.stringify(data);
    } catch (e) {
      // If JSON parsing fails, fall back to text
      try {
        errorMessage = await res.text();
      } catch (textError) {
        // If all else fails, use the status text
        errorMessage = res.statusText;
      }
    }

    // Create a more detailed error object
    const error = new Error(`${res.status}: ${errorMessage}`);
    // Add custom properties for specific error handling
    (error as any).status = res.status;
    (error as any).isInsufficientFunds = errorMessage.includes('insufficient funds') || 
                                         errorMessage.includes('insufficient balance');
    (error as any).isNetworkError = res.status >= 500 || res.status === 0;
    (error as any).isAuthError = res.status === 401 || res.status === 403;
    
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { timeout?: number, retries?: number },
): Promise<Response> {
  try {
    // Set up retry mechanism with larger limit for live events
    const maxRetries = options?.retries ?? 
      (url.includes('/api/events') && url.includes('isLive=true') ? 3 : 2);
    let currentRetry = 0;
    
    // Determine if this is a critical endpoint
    const isCriticalEndpoint = url.includes('/api/events') || 
                              url.includes('/api/sports') ||
                              url.includes('/api/promotions');
    
    // Create attemptFetch as an async arrow function to avoid strict mode issues
    const attemptFetch = async (): Promise<Response> => {
      // If a timeout is specified, use AbortController to enforce it
      let abortController: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;
      
      try {
        // Increase default timeout for API calls with tiered approach
        let effectiveTimeout = 20000; // Base timeout 20s - increased from 15s
        
        // Adjust timeout based on endpoint and data size
        if (url.includes('/api/events')) {
          if (url.includes('isLive=true')) {
            effectiveTimeout = 40000; // 40s for live events (large data) - increased from 30s
          } else {
            effectiveTimeout = 30000; // 30s for other events - increased from 25s
          }
        }
        
        // Allow override from options
        effectiveTimeout = options?.timeout || effectiveTimeout;
        
        // Add jitter for retries to avoid thundering herd
        if (currentRetry > 0) {
          const jitter = Math.random() * 2000;
          effectiveTimeout += (currentRetry * 7000) + jitter; // Increased delay between retries
        }
        
        // Always use an AbortController with timeout to avoid hanging requests
        abortController = new AbortController();
        timeoutId = setTimeout(() => {
          abortController?.abort(`Request timeout after ${effectiveTimeout}ms`);
        }, effectiveTimeout);
        
        // Only log if not a recurring system check
        if (!url.includes('/api/auth/wallet-status')) {
          console.log(`API Request to ${url} with ${effectiveTimeout}ms timeout${currentRetry > 0 ? ` (retry ${currentRetry}/${maxRetries})` : ''}`);
        }
        
        // Prepare headers with additional metadata
        const headers: Record<string, string> = {};
        
        // Add content-type for data payloads
        if (data) {
          headers["Content-Type"] = "application/json";
        }
        
        // Add retry count in header for debugging
        if (currentRetry > 0) {
          headers["X-Retry-Count"] = currentRetry.toString();
        }
        
        // Add cache control for live endpoints
        if (url.includes('isLive=true')) {
          headers["Cache-Control"] = "no-cache, no-store";
        }
        
        const res = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
          signal: abortController.signal,
          // Add cache-busting for retries
          cache: currentRetry > 0 ? 'no-cache' : 'default'
        });
        
        // Clear the timeout if the request completed successfully
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        
        return res;
      } catch (error) {
        // Clear any pending timeouts
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        
        // Check if we can retry
        if (currentRetry < maxRetries && shouldRetryError(error)) {
          currentRetry++;
          // Only log if not a recurring system check
          if (!url.includes('/api/auth/wallet-status')) {
            console.log(`Retrying API request to ${url} (attempt ${currentRetry}/${maxRetries})`);
          }
          
          // Add exponential backoff delay to avoid hammering the server
          const backoffMs = Math.min(1000 * Math.pow(1.5, currentRetry) + (Math.random() * 1000), 8000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          
          return attemptFetch(); // Recursive retry after backoff
        }
        
        // If we can't retry, rethrow the error
        throw error;
      }
    };
    
    // Helper to determine if error is retryable
    const shouldRetryError = (error: any): boolean => {
      // Always retry critical endpoints on timeout
      if (error instanceof DOMException && error.name === 'AbortError' && isCriticalEndpoint) {
        return true;
      }
      
      // Always retry network errors on critical endpoints
      if (error instanceof TypeError && isCriticalEndpoint && 
          (error.message.includes('NetworkError') || 
           error.message.includes('Failed to fetch'))) {
        return true;
      }
      
      // For non-critical endpoints, be more selective
      if (!isCriticalEndpoint) {
        // Only retry specific errors for non-critical endpoints
        if (error instanceof DOMException && error.name === 'AbortError') {
          return true;
        }
        
        if (error instanceof TypeError && 
            (error.message.includes('NetworkError') || 
             error.message.includes('Failed to fetch'))) {
          return true;
        }
      }
      
      // Default to not retrying
      return false;
    };
    
    // Start the fetch process with retry support
    const res = await attemptFetch();

    // Enhanced handling for network errors and sports data API issues
    if (res.status >= 500 || res.status === 0) {
      console.warn(`Server error ${res.status} from ${url}`);
      
      // For any endpoints related to sports data, try to use fallbacks
      if (url.includes('/api/events')) {
        console.log(`Attempting fallback for API request: ${url}`);
        
        try {
          // First, try the tracked events endpoint which is more reliable
          const fallbackResponse = await fetch('/api/events/tracked', {
            credentials: "include",
            // Set a timeout for fallback requests
            signal: AbortSignal.timeout(10000)
          });
          
          if (fallbackResponse.ok) {
            console.log("Successfully used tracked events fallback");
            // Add metadata about using fallback
            Object.defineProperty(fallbackResponse, 'usedFallback', {
              value: true,
              writable: false
            });
            return fallbackResponse;
          }
        } catch (fallbackError) {
          console.warn('Primary fallback request failed:', fallbackError);
        }
        
        // If tracked events fails or is not available, try events without parameters
        try {
          const secondaryFallbackResponse = await fetch('/api/events', {
            credentials: "include",
            // Set a timeout for secondary fallback
            signal: AbortSignal.timeout(8000)
          });
          
          if (secondaryFallbackResponse.ok) {
            console.log("Successfully used secondary events fallback");
            // Add metadata about using fallback
            Object.defineProperty(secondaryFallbackResponse, 'usedFallback', {
              value: true,
              writable: false
            });
            return secondaryFallbackResponse;
          }
        } catch (secondaryFallbackError) {
          console.warn('Secondary fallback request also failed:', secondaryFallbackError);
        }
      }
    }
    
    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    // Enhanced error handling with better recovery and reporting
    console.error(`API request error for ${url}:`, error);
    
    // Check for various error types and handle appropriately
    if (error instanceof TypeError) {
      // Network errors, connection issues
      console.warn(`Network error during fetch to ${url}:`, error.message);
      
      // For critical API endpoints, provide recovery options
      if (url.includes('/api/events')) {
        console.warn('Creating recovery response for events API');
        
        // Empty array response - important to maintain expected data structure
        const recoveryResponse = new Response(
          JSON.stringify([]), 
          { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' },
          }
        );
        
        // Add metadata for debugging
        Object.defineProperty(recoveryResponse, 'recoveredFrom', {
          value: error.message,
          writable: false
        });
        
        return recoveryResponse;
      }
    } else if (error instanceof SyntaxError) {
      // JSON parsing errors
      console.warn(`Invalid JSON in response from ${url}`);
      
      // For JSON parse errors in events endpoint, return empty array
      if (url.includes('/api/events')) {
        return new Response(
          JSON.stringify([]), 
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      // Timeout/abort errors
      console.warn(`Request to ${url} was aborted (likely timeout)`);
      
      // For timeout errors in events endpoint, return empty array
      if (url.includes('/api/events')) {
        return new Response(
          JSON.stringify([]), 
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Re-throw other errors with enhanced context
    if (error instanceof Error) {
      error.message = `API request to ${url} failed: ${error.message}`;
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      // Use our enhanced API request function for all queries
      // This gives us retry, timeout, and error recovery for free
      const res = await apiRequest('GET', queryKey[0] as string);
      
      // Handle 401 based on the specified behavior
      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }
      
      await throwIfResNotOk(res);
      
      // Handle different content types
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          return await res.json();
        } catch (jsonError) {
          console.error('Error parsing JSON from response:', jsonError);
          // For critical endpoints, return appropriate fallback value
          if ((queryKey[0] as string).includes('/api/events')) {
            console.warn('Returning empty array for events endpoint due to JSON parse error');
            return [];
          }
          throw jsonError;
        }
      } else {
        // For non-JSON responses, just return the text
        return await res.text();
      }
    } catch (error) {
      // Add query key information to the error for better debugging
      if (error instanceof Error) {
        error.message = `Query failed for ${queryKey[0]}: ${error.message}`;
      }
      
      // For critical endpoints, return empty arrays instead of failing completely
      if ((queryKey[0] as string).includes('/api/events')) {
        console.warn('Returning empty array for events endpoint due to error:', error);
        return [];
      }
      
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      // Enable retry for specific endpoints with pattern matching
      retry: (failureCount, error: any) => {
        // Don't retry more than 2 times (3 total attempts)
        if (failureCount >= 2) return false;
        
        // Check if this is a query for events or sports - critical data
        const queryKey = error?.meta?.request?.url || '';
        const isCriticalEndpoint = 
          queryKey.includes('/api/events') || 
          queryKey.includes('/api/sports');
          
        // Only retry for critical endpoints and specific error types
        if (isCriticalEndpoint) {
          const isNetworkError = error instanceof TypeError;
          const isServerError = error?.message?.includes('500') || error?.status === 500;
          const isTimeoutError = error instanceof DOMException && error.name === 'AbortError';
          
          return isNetworkError || isServerError || isTimeoutError;
        }
        
        return false;
      },
      retryDelay: attemptIndex => Math.min(1000 * (2 ** attemptIndex), 10000),
    },
    mutations: {
      retry: false,
    },
  },
});
