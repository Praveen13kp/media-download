import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.media.download.manager',
  appName: 'Media Download Manager',
  webDir: 'dist',
  server: {
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
