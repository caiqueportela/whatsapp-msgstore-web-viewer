import { Conversation, Message } from '../types';

declare global {
  interface Window {
    desktopAPI?: {
      getApiBaseUrl: () => Promise<string>;
      selectDbFile: () => Promise<string | null>;
      selectMediaFolder: () => Promise<string | null>;
    };
  }
}

let cachedBaseUrl: string | null = null;

const getBaseUrl = async (): Promise<string> => {
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }

  if (!window.desktopAPI) {
    throw new Error('A API desktop não está disponível. Rode via Electron.');
  }

  cachedBaseUrl = await window.desktopAPI.getApiBaseUrl();
  return cachedBaseUrl;
};

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = 'Falha na requisição.';
    try {
      const body = await response.json();
      errorMessage = body.error || errorMessage;
    } catch {
      // ignore parsing errors
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
};

export const selectDbFile = async (): Promise<string | null> => {
  if (!window.desktopAPI) return null;
  return window.desktopAPI.selectDbFile();
};

export const selectMediaFolder = async (): Promise<string | null> => {
  if (!window.desktopAPI) return null;
  return window.desktopAPI.selectMediaFolder();
};

export const openDatabase = async (dbPath: string, mediaRootPath?: string | null): Promise<void> => {
  await apiFetch('/api/open-db', {
    method: 'POST',
    body: JSON.stringify({ dbPath, mediaRootPath }),
  });
};

export const getConversations = async (
  limit: number,
  offset: number,
  search: string
): Promise<{ data: Conversation[]; total: number }> => {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    search,
  });

  return apiFetch(`/api/conversations?${params.toString()}`);
};

export const getMessages = async (
  chatId: number,
  limit: number,
  offset: number,
  search: string
): Promise<{ data: Message[]; total: number }> => {
  const params = new URLSearchParams({
    chatId: String(chatId),
    limit: String(limit),
    offset: String(offset),
    search,
  });

  return apiFetch(`/api/messages?${params.toString()}`);
};

export const getMediaUrl = async (relativeUrl: string): Promise<string> => {
  const baseUrl = await getBaseUrl();
  return `${baseUrl}${relativeUrl}`;
};
