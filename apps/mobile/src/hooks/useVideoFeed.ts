import { useCallback, useEffect, useState } from 'react';
import { apiGet, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import { parseFeedPage, type FeedPage } from '@/api/contracts';

interface FeedResult extends FeedPage {
  key: string;
  page: number;
  error: string | null;
}

export function useVideoFeed(
  path: string,
  enabled = true,
  onUnauthorized?: () => void,
) {
  const [refreshNumber, setRefreshNumber] = useState(0);
  const [result, setResult] = useState<FeedResult>();
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreErrorResult, setMoreErrorResult] = useState<{ key: string; message: string }>();
  const requestKey = `${path}:${enabled}:${refreshNumber}`;
  const resultIsCurrent = result?.key === requestKey;
  const videos = resultIsCurrent ? result.videos : [];
  const hasMore = resultIsCurrent && result.hasMore;
  const isLoading = enabled && !resultIsCurrent;
  const isLoadingMore = loadingMoreKey === requestKey;
  const error = resultIsCurrent ? result.error : null;
  const moreError = moreErrorResult?.key === requestKey ? moreErrorResult.message : null;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    apiGet<unknown>(path, { page: 1, limit: 12 }, controller.signal)
      .then((data) => {
        const pageResult = parseFeedPage(data);
        setResult({
          key: requestKey,
          ...pageResult,
          page: 1,
          error: null,
        });
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          if (isUnauthorizedError(requestError)) onUnauthorized?.();
          setResult({
            key: requestKey,
            videos: [],
            hasMore: false,
            page: 1,
            error: getApiErrorMessage(requestError, 'Please try again in a moment.'),
          });
        }
      });

    return () => controller.abort();
  }, [enabled, onUnauthorized, path, requestKey]);

  const retry = useCallback(() => setRefreshNumber((current) => current + 1), []);

  const loadMore = useCallback(async () => {
    if (!enabled || !resultIsCurrent || isLoading || isLoadingMore || !hasMore || !result) return;
    const nextPage = result.page + 1;
    setLoadingMoreKey(requestKey);
    setMoreErrorResult(undefined);
    try {
      const data = await apiGet<unknown>(path, { page: nextPage, limit: 12 });
      const pageResult = parseFeedPage(data);
      setResult((current) => current?.key === requestKey
        ? {
          ...current,
          videos: [...current.videos, ...pageResult.videos],
          hasMore: pageResult.hasMore,
          page: nextPage,
        }
        : current);
    } catch (requestError) {
      if (isUnauthorizedError(requestError)) onUnauthorized?.();
      setMoreErrorResult({
        key: requestKey,
        message: getApiErrorMessage(requestError, 'More videos could not be loaded.'),
      });
    } finally {
      setLoadingMoreKey((current) => current === requestKey ? null : current);
    }
  }, [
    enabled,
    hasMore,
    isLoading,
    isLoadingMore,
    onUnauthorized,
    path,
    requestKey,
    result,
    resultIsCurrent,
  ]);

  return {
    videos,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    moreError,
    retry,
    loadMore,
  };
}
