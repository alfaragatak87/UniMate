# Panduan Pengujian UI Berbasis Playwright

Dokumen ini adalah referensi teknis arsitektur pengujian Playwright untuk melengkapi [SKILL.md](../SKILL.md).

---

## 1. Konfigurasi Lingkungan Terisolasi

Jika pengujian otomatis berbasis Playwright diterapkan di masa mendatang:

```javascript
// Contoh konfigurasi: playwright.config.js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Menghindari perebutan resource port
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'Desktop Chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile PWA Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

---

## 2. Pola Pengujian Khusus UniMate

### A. Pengujian Offline PWA (Simulasi Tanpa Internet)
```javascript
test('Scanner offline tetap berfungsi saat koneksi internet mati', async ({ context, page }) => {
  await page.goto('/#/ai-scanner');
  
  // Matikan koneksi jaringan
  await context.setOffline(true);
  
  // Verifikasi halaman dan komponen lokal tetap aktif
  await expect(page.locator('text=AI Scanner')).toBeVisible();
  
  // Kembalikan koneksi setelah pengujian selesai
  await context.setOffline(false);
});
```

### B. Pengujian Jendela Desktop Electron
Playwright mendukung kendali jendela Electron langsung melalui modul `_electron`:

```javascript
import { _electron as electron } from 'playwright';

test('Jendela Electron memuat aplikasi dengan context isolation', async () => {
  const electronApp = await electron.launch({ args: ['electron/main.cjs'] });
  const window = await electronApp.firstWindow();
  
  await expect(window).toHaveTitle(/UniMate/);
  
  // Verifikasi preload bridge terdaftar
  const hasBridge = await window.evaluate(() => typeof window.electronAPI !== 'undefined');
  expect(hasBridge).toBe(true);
  
  await electronApp.close();
});
```

---

## 3. Aturan Isolasi Data Pengujian

1. **Pembersihan State**:
   * Setiap skenario pengujian wajib membersihkan `localStorage` dan `IndexedDB` buatan agar tidak mencemari pengujian berikutnya.
2. **Mocking Jaringan Penuh**:
   * Rute jaringan eksternal (misal Firebase Auth, PeerJS signaling, Gemini API) wajib di-intercept dan di-mock secara lokal (`page.route('**/*', ...)`). DILARANG membiarkan skrip pengujian memanggil API eksternal sungguhan.
