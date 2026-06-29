import React from "react";

export default function PrivacyPolicy() {
  return (
    <div style={{maxWidth:"1000px",margin:"0 auto",padding:"24px",lineHeight:1.7}}>
      <h1>Privacy Policy</h1>      <p>Last Updated: June 2026</p>
      <p>Dungeon Calendar collects account, campaign, scheduling, and subscription information necessary to provide the service.</p>
      <h2>Information We Collect</h2>      <p>We may collect your name, username, email address, optional phone number, profile settings, campaign membership, character names, availability responses, campaign settings, and subscription status.</p>
      <h2>Google Sign-In and Google User Data</h2>      <p>Dungeon Calendar supports optional Sign in with Google using Google OAuth through Firebase Authentication.</p>
      <h3>Google User Data Accessed</h3>      <p>When you choose to sign in with Google, Dungeon Calendar accesses only the basic Google account information needed to authenticate you and create or access your Dungeon Calendar account:</p>      <ul>        <li>Email address</li>        <li>Display name or name associated with your Google Account</li>        <li>Google Account profile photo, if available</li>        <li>Google/Firebase unique user identifier used to keep the same account across web and mobile</li></ul>
      <p>Dungeon Calendar does not request or access Gmail messages, Google Drive files, Google Calendar events, Google Contacts, Google Photos, or other Google Workspace content.</p>
      <h3>How Google User Data Is Used</h3>      <p>Google user data is used only to authenticate your account, create or access your Dungeon Calendar profile, keep the same user account across web and mobile, associate campaigns and invitations with your account, sync your subscription plan and app settings, and display your account name or profile image inside the app.</p>
      <h3>How Google User Data Is Stored</h3>      <p>Authentication is handled by Firebase Authentication. Basic account profile data and app data are stored in Cloud Firestore under your Firebase user ID. Dungeon Calendar stores only the minimum account information needed to operate the service.</p>
      <h3>How Google User Data Is Shared</h3>      <p>Dungeon Calendar does not sell Google user data. Google user data is not shared with advertisers or unrelated third parties. It may be processed by trusted service providers needed to operate the app, including Google Firebase services for authentication, hosting, storage, and database functionality.</p>
      <h3>Limited Use Disclosure</h3>      <p>Dungeon Calendar's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google user data is used only to provide and improve user-facing Dungeon Calendar features. Google user data is not used to train generalized artificial intelligence or machine learning models.</p>
      <h2>How We Use Information</h2>      <p>We use this information to operate Dungeon Calendar, manage campaigns, schedule sessions, save user settings, process subscription access, provide support, prevent duplicate accounts, maintain security, and improve reliability.</p>
      <h2>Firebase, Google Analytics, and Stripe</h2>      <p>Dungeon Calendar uses Firebase for authentication, cloud storage, Firestore database functionality, hosting, and related app operations. Dungeon Calendar may use Google Analytics to understand general app usage and reliability. Stripe processes subscription payments. Dungeon Calendar does not store full credit card numbers.</p>
      <h2>Data Sharing</h2>      <p>We do not sell personal information. Data may be shared with service providers necessary to operate the app, including Firebase, Google Analytics, and Stripe.</p>
      <h2>Account Updates and Deletion</h2>      <p>You may update profile information in the app. You may request deletion of your account and associated personal data from within the app or by contacting support.</p>
      <h2>Children's Privacy</h2>      <p>Dungeon Calendar is not directed toward children under 13 without appropriate parental or guardian involvement.</p>
      <h2>Contact</h2>      <p>Email: <a href="mailto:support@dungeoncalendar.com">support@dungeoncalendar.com</a></p>

    </div>
  );
}
