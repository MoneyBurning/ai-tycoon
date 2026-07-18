const firebaseConfig = {
  apiKey: "AIzaSyAv6St9BYIfubINvFnuyIdVHOZgaJUTgAs",
  authDomain: "ai-tycoon-game.firebaseapp.com",
  databaseURL: "https://ai-tycoon-game-default-rtdb.firebaseio.com",
  projectId: "ai-tycoon-game",
  storageBucket: "ai-tycoon-game.firebasestorage.app",
  messagingSenderId: "767418194661",
  appId: "1:767418194661:web:c2f370d9bcf4b2cc54520c",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
