import { initializeApp } from 'firebase/app';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
const uid = new URL(import.meta.url).searchParams.get('u');
export const NAMESPACE = 'demo-mukando-js';
const app = initializeApp({ projectId: NAMESPACE, databaseURL: `http://127.0.0.1:9019?ns=${NAMESPACE}` }, 'app-' + uid);
export const database = getDatabase(app);
connectDatabaseEmulator(database, '127.0.0.1', 9019, uid === 'anonymous' ? {} : { mockUserToken: { sub: uid, user_id: uid } });
export const auth = { authStateReady: async () => {}, currentUser: null };
