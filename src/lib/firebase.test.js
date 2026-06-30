import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/analytics', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isSupported: vi.fn(),
    getAnalytics: vi.fn(),
  };
});

import { isSupported, getAnalytics } from 'firebase/analytics';
import {
  firebaseConfig,
  app,
  db,
  auth,
  storage,
  getAppAnalytics,
  resetAnalyticsPromise
} from './firebase.js';

describe('Firebase SDK Setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAnalyticsPromise();
  });

  it('should export the correct firebaseConfig', () => {
    expect(firebaseConfig).toEqual({
      apiKey: "AIzaSyDovmjClkov6q1qRQkkgCExH31rEbX0X2M",
      authDomain: "crewhub-43647.firebaseapp.com",
      projectId: "crewhub-43647",
      storageBucket: "crewhub-43647.firebasestorage.app",
      messagingSenderId: "847443127747",
      appId: "1:847443127747:web:8015626f31bf99b713a176",
      measurementId: "G-Z7BVFKESL4"
    });
  });

  it('should initialize and export Firebase app instance', () => {
    expect(app).toBeDefined();
    expect(app.name).toBe('[DEFAULT]');
  });

  it('should initialize and export Firestore instance (db)', () => {
    expect(db).toBeDefined();
    expect(db.type).toBe('firestore');
  });

  it('should initialize and export Firebase Auth instance (auth)', () => {
    expect(auth).toBeDefined();
    expect(auth.name).toBe('[DEFAULT]');
  });

  it('should initialize and export Firebase Storage instance (storage)', () => {
    expect(storage).toBeDefined();
    expect(storage.app).toBe(app);
  });

  it('should get or initialize analytics when isSupported returns false', async () => {
    vi.mocked(isSupported).mockResolvedValue(false);
    const analyticsInstance = await getAppAnalytics();
    expect(analyticsInstance).toBeNull();
  });

  it('should return cached analytics promise on subsequent calls', async () => {
    vi.mocked(isSupported).mockResolvedValue(false);
    const firstCall = getAppAnalytics();
    const secondCall = getAppAnalytics();
    expect(firstCall).toBe(secondCall);
    await expect(firstCall).resolves.toBeNull();
  });

  it('should initialize and return getAnalytics when isSupported returns true', async () => {
    const fakeAnalytics = { app };
    vi.mocked(isSupported).mockResolvedValue(true);
    vi.mocked(getAnalytics).mockReturnValue(fakeAnalytics);

    const analyticsInstance = await getAppAnalytics();
    expect(isSupported).toHaveBeenCalled();
    expect(getAnalytics).toHaveBeenCalledWith(app);
    expect(analyticsInstance).toBe(fakeAnalytics);
  });

  it('should return null when isSupported rejects with an error', async () => {
    vi.mocked(isSupported).mockRejectedValue(new Error('Analytics not supported in this environment'));

    const analyticsInstance = await getAppAnalytics();
    expect(analyticsInstance).toBeNull();
  });

  it('should reuse existing app instance when getApps() is not empty upon module load', async () => {
    vi.resetModules();
    const reimportedModule = await import('./firebase.js');
    expect(reimportedModule.app).toBeDefined();
    expect(reimportedModule.app.name).toBe('[DEFAULT]');
  });
});
