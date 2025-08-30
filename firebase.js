// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBK38Aerd4q05ckdoIMUd6qt2JCuSgPu7k",
  authDomain: "customer-dashboard-82cd9.firebaseapp.com",
  projectId: "customer-dashboard-82cd9",
  storageBucket: "customer-dashboard-82cd9.firebasestorage.app",
  messagingSenderId: "849559562503",
  appId: "1:849559562503:web:05e896069a3facef353da2",
  measurementId: "G-945SLZNQ6V"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export default app;