import { useEffect, useState } from 'react';

type AsyncResult<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'success'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: unknown };

export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncResult<T> {
  const [result, setResult] = useState<AsyncResult<T>>({ status: 'loading', data: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    setResult({ status: 'loading', data: undefined, error: undefined });

    fetcher()
      .then((data) => {
        if (!cancelled) setResult({ status: 'success', data, error: undefined });
      })
      .catch((error) => {
        if (!cancelled) setResult({ status: 'error', data: undefined, error });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}
