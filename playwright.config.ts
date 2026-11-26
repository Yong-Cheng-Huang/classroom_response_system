import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', channel: 'chrome', headless: true,
    ...(process.env.CRS_CHROME_EXECUTABLE?{launchOptions:{executablePath:process.env.CRS_CHROME_EXECUTABLE}}:{}) },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    env: { APP_PORT: '3100', APP_DATA_DIR: './test-results/browser-data', TEACHER_PASSWORD: '',GOOGLE_OAUTH_CLIENT_FILE:'./test-results/browser-data/no-google-client.json' },
    timeout: 30000,
  },
});
