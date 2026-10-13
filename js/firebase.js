// CDN modules keep the app build-free. Use the same SDK version for every product.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
export const firebaseConfig = {
  apiKey: 'AIzaSyA8cFOyMaCkqeMxq2QdUY8O0Z8omf87jlQ',
  authDomain: 'scanpoly-f2834.firebaseapp.com',
  databaseURL: 'https://scanpoly-f2834-default-rtdb.firebaseio.com',
  projectId: 'scanpoly-f2834',
  storageBucket: 'scanpoly-f2834.firebasestorage.app',
  messagingSenderId: '520914350359',
  appId: '1:520914350359:web:9ecd087cd8b7df67208752'
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
