import axios from 'axios';
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
export const apiClient = axios.create({
    baseURL: configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, '') : undefined,
    withCredentials: true,
});
export function getApiErrorMessage(error, fallback) {
    if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error;
        if (typeof message === 'string')
            return message;
        if (error.response?.status === 502
            || error.response?.status === 504
            || error.code === 'ERR_NETWORK') {
            return 'The WatchTube API could not be reached. Check the API service connection, then retry.';
        }
    }
    return fallback;
}
