Firebase login has been added.

Run:
npm install firebase

Firebase Console:
1. Authentication > Sign-in method > enable Email/Password.
2. Firestore Database > create database.
3. Development Firestore rules:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
