const firebaseConfig = {
  apiKey: "AIzaSyAQSb-Ecwta08ZnYcF4ssJAmEzp_LpiwUk",
  authDomain: "mitti-mantra.firebaseapp.com",
  projectId: "mitti-mantra",
  storageBucket: "mitti-mantra.firebasestorage.app",
  messagingSenderId: "657432156181",
  appId: "1:657432156181:web:fd74715c74bdd212ab161c",
  measurementId: "G-91KG5EZ8P1"
};

// Initialize Firebase (using compat libraries loaded in HTML)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
} else {
  firebase.app();
}

window.MittiFirebase = {
  auth: firebase.auth(),
  db: firebase.firestore(),
  googleProvider: new firebase.auth.GoogleAuthProvider(),
};
