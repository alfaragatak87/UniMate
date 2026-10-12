import { initializeApp, getApps } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const getFirebaseConfig = () => {
  try {
    const configStr = localStorage.getItem('unimate_firebase_config');
    if (configStr) {
      return JSON.parse(configStr);
    }
  } catch (e) {
    console.error('Failed to parse firebase config', e);
  }
  return null;
};

const config = getFirebaseConfig();

let app = null;
let db = null;

if (config && config.apiKey && config.projectId) {
  try {
    if (!getApps().length) {
      app = initializeApp(config);
    } else {
      app = getApps()[0];
    }
    db = getDatabase(app);
  } catch (error) {
    console.error('Firebase init error', error);
  }
}

export { app, db };
