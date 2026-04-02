import { beforeEach, describe, expect, it, vi } from 'vitest';

const createDesktopApi = () => ({
  getApiBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3210'),
  selectDbFile: vi.fn().mockResolvedValue('/tmp/msgstore.db'),
  selectMediaFolder: vi.fn().mockResolvedValue('/tmp/media'),
});

describe('apiService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('abre banco via endpoint local', async () => {
    const desktopAPI = createDesktopApi();
    vi.stubGlobal('window', { desktopAPI });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const module = await import('../services/apiService');
    await module.openDatabase('/tmp/msgstore.db', '/tmp/media');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3210/api/open-db');
  });

  it('retorna caminho selecionado pelo frontend', async () => {
    const desktopAPI = createDesktopApi();
    vi.stubGlobal('window', { desktopAPI });

    const module = await import('../services/apiService');
    const dbPath = await module.selectDbFile();
    const mediaPath = await module.selectMediaFolder();

    expect(dbPath).toBe('/tmp/msgstore.db');
    expect(mediaPath).toBe('/tmp/media');
  });
});
