export interface BackCapableRouter {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: '/') => void;
}

/** Navigates back when history exists, otherwise returns safely to the Home feed. */
export function goBackOrHome(router: BackCapableRouter): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}
