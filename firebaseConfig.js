import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAGe9rzKe3Cjtzl342yBtAfRFOfQ8_A_yE",
  authDomain: "my-media-db.firebaseapp.com",
  projectId: "my-media-db",
  storageBucket: "my-media-db.appspot.com",
  messagingSenderId: "286526198339",
  appId: "1:286526198339:web:b8b0bf81e52881c0c53af6",
  measurementId: "G-EWLZTJM3KB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const auth = getAuth(app);

export default app;