export function shouldRefreshSessionOnForeground(
  previousState: string | null | undefined,
  nextState: string,
): boolean {
  return previousState !== null
    && previousState !== undefined
    && previousState !== 'active'
    && nextState === 'active';
}
