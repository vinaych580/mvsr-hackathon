/**
 * Firebase Config Initialization
 * 
 * Instead of hardcoding the API key in the source code where it gets
 * pushed to GitHub, we fetch it from the backend endpoint.
 * The backend pulls it from environment variables (.env / Vercel secrets).
 */

(async () => {
  try {
    // Fetch the config from our backend (which reads from .env)
    const res = await fetch('/api/firebase-config');
    if (!res.ok) throw new Error("Failed to load Firebase config from server");
    
    const firebaseConfig = await res.json();

    // Initialize Firebase (using compat libraries loaded in HTML)
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "") {
      console.warn("Mitti Mantra: Firebase API Key is entirely missing from environment variables.");
    } else {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      } else {
        firebase.app();
      }

      // Expose globally so auth.js and user-data.js can use it
      window.MittiFirebase = {
        auth: firebase.auth(),
        db: firebase.firestore(),
        googleProvider: new firebase.auth.GoogleAuthProvider(),
      };
      
      // Tell other scripts that Firebase is ready!
      window.dispatchEvent(new Event('mitti-firebase-ready'));
    }
  } catch (err) {
    console.error("Could not initialize Firebase:", err);
  }
})();
