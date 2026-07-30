import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

// Remplacez ces valeurs par celles transmises par votre console Firebase :
const firebaseConfig = {
  apiKey: "AIzaSyB9LPKWiN-WZyf-UadZrbwH6066yIg7Xyg",
  authDomain: "grace-a731e.firebaseapp.com",
  projectId: "grace-a731e",
  storageBucket: "grace-a731e.firebasestorage.app",
  messagingSenderId: "888066535649",
  appId: "1:888066535649:web:0faac5f99fbf8ffa2c87a0"
};

// Initialisation de l'application Firebase
export const app = initializeApp(firebaseConfig);