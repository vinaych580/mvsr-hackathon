/* ================================================================
   Firebase Configuration
   1. Copy this file to firebase-config.js
   2. Replace the placeholder values with your project's config
      from: Firebase Console → Project Settings → General → Your apps
   3. Enable Google and Email/Password in Authentication → Sign-in method
   ================================================================ */
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID"
};

firebase.initializeApp(firebaseConfig);
