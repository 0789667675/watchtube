import { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';

interface ShortsRateChange {
  id: string;
  actorId: string;
  previousRatePercent: string;
  newRatePercent: string;
  changedAt: string;
}

interface ShortsRateSettings {
  ratePercent: string;
  updatedAt: string;
  updatedById: string | null;
  history: ShortsRateChange[];
}

const RATE_PERCENT_PATTERN = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;

function isRateChange(value: unknown): value is ShortsRateChange {
  if (!value || typeof value !== 'object') return false;
  const change = value as Record<string, unknown>;
  return typeof change.id === 'string'
    && typeof change.actorId === 'string'
    && typeof change.previousRatePercent === 'string'
    && RATE_PERCENT_PATTERN.test(change.previousRatePercent)
    && typeof change.newRatePercent === 'string'
    && RATE_PERCENT_PATTERN.test(change.newRatePercent)
    && typeof change.changedAt === 'string'
    && Number.isFinite(Date.parse(change.changedAt));
}

function isRateSettings(value: unknown): value is ShortsRateSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.ratePercent === 'string'
    && RATE_PERCENT_PATTERN.test(settings.ratePercent)
    && typeof settings.updatedAt === 'string'
    && Number.isFinite(Date.parse(settings.updatedAt))
    && (typeof settings.updatedById === 'string' || settings.updatedById === null)
    && Array.isArray(settings.history)
    && settings.history.every(isRateChange);
}

function isRateUpdate(value: unknown): value is Omit<ShortsRateSettings, 'history'> & { change: ShortsRateChange | null } {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return typeof update.ratePercent === 'string'
    && RATE_PERCENT_PATTERN.test(update.ratePercent)
    && typeof update.updatedAt === 'string'
    && Number.isFinite(Date.parse(update.updatedAt))
    && (typeof update.updatedById === 'string' || update.updatedById === null)
    && (update.change === null || isRateChange(update.change));
}

export function ShortsRateSettingsCard() {
  const [settings, setSettings] = useState<ShortsRateSettings | null>(null);
  const [draftRate, setDraftRate] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    apiClient.get<unknown>('/api/v1/admin/monetization/shorts-rate')
      .then(({ data }) => {
        if (!isCurrent) return;
        if (!isRateSettings(data)) {
          setLoadError('Shorts monetization settings returned an invalid response.');
          return;
        }
        setSettings(data);
        setDraftRate(data.ratePercent);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(getApiErrorMessage(error, 'Shorts monetization settings are unavailable.'));
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const saveRate = async () => {
    if (!settings || !RATE_PERCENT_PATTERN.test(draftRate)) return;
    if (!window.confirm(`Change the Shorts Monetization Rate from ${settings.ratePercent}% to ${draftRate}%?`)) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const { data } = await apiClient.put<unknown>(
        '/api/v1/admin/monetization/shorts-rate',
        { ratePercent: draftRate },
      );
      if (!isRateUpdate(data)) {
        setSaveError('The Shorts rate response could not be verified. Reload before making another change.');
        return;
      }

      setSettings({
        ratePercent: data.ratePercent,
        updatedAt: data.updatedAt,
        updatedById: data.updatedById,
        history: data.change
          ? [data.change, ...settings.history].slice(0, 50)
          : settings.history,
      });
      setDraftRate(data.ratePercent);
    } catch (error) {
      setSaveError(getApiErrorMessage(error, 'The Shorts monetization rate could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  const draftIsValid = RATE_PERCENT_PATTERN.test(draftRate);

  return (
    <section className="rounded-xl border border-border-light bg-surface-light p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark">
      <h2 className="text-xl font-bold">Shorts Monetization Rate</h2>
      <p className="mt-2 text-sm text-text-muted">
        Creator earnings are the standard creator earnings multiplied by this rate. Only eligible, attributed revenue
        qualifies; views alone do not generate earnings.
      </p>

      {isLoading && <p role="status" className="mt-4 text-sm text-text-muted">Loading current Shorts rate…</p>}
      {loadError && <p role="alert" className="mt-4 text-sm text-red-600">{loadError}</p>}

      {settings && (
        <>
          <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="text-sm font-medium text-text-muted">Current rate</p>
              <p className="mt-1 text-3xl font-bold">{settings.ratePercent}%</p>
              <p className="mt-1 text-xs text-text-muted">
                Updated {new Date(settings.updatedAt).toLocaleString()}
                {settings.updatedById ? ` by administrator ${settings.updatedById}` : ' (system default)'}
              </p>
            </div>
            <div className="space-y-3">
              <label htmlFor="shorts-rate-percent" className="block text-sm font-medium">
                New rate (0.00–100.00%)
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="shorts-rate-percent"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draftRate}
                  onChange={(event) => setDraftRate(event.target.value)}
                  aria-invalid={!draftIsValid}
                  className="min-h-11 w-36 rounded-control border border-border-light bg-canvas-light px-3 text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                />
                <span aria-hidden="true">%</span>
                <button
                  type="button"
                  disabled={!draftIsValid || isSaving || draftRate === settings.ratePercent}
                  onClick={saveRate}
                  className="min-h-11 rounded-control bg-brand-action px-4 font-semibold text-brand-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save rate'}
                </button>
              </div>
            </div>
          </div>

          {saveError && <p role="alert" className="mt-4 text-sm text-red-600">{saveError}</p>}
          <div className="mt-6 border-t border-border-light pt-4 dark:border-border-dark">
            <h3 className="font-semibold">Rate change audit history</h3>
            {settings.history.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">No administrator changes recorded.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {settings.history.map((change) => (
                  <li key={change.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <span>
                      {change.previousRatePercent}% → {change.newRatePercent}% by administrator {change.actorId}
                    </span>
                    <time dateTime={change.changedAt} className="text-text-muted">
                      {new Date(change.changedAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
