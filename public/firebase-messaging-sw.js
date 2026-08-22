// Chismisa Firebase messaging service worker — handles background push
// notifications for web/PWA users.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

// Firebase config — public values, safe to expose client-side.
// Project: chismisa-fd9b8
firebase.initializeApp({
  apiKey: "AIzaSyDsWFZWCZ0Qnqt1veZdl-8rttkp7h13IZA",
  authDomain: "chismisa-fd9b8.firebaseapp.com",
  projectId: "chismisa-fd9b8",
  storageBucket: "chismisa-fd9b8.firebasestorage.app",
  messagingSenderId: "125114823607",
  appId: "1:125114823607:web:REPLACE-WITH-WEB-APP-ID",
});

const messaging = firebase.messaging();

// Handle background push messages
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "New message";
  const body = payload.notification?.body || "";
  const groupId = payload.data?.groupId;

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: groupId || "chismisa", // group notifications by group
    data: { groupId },
    vibrate: [100, 50, 100],
  });
});

// Handle notification click — open the relevant group
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const groupId = event.notification.data?.groupId;
  const url = groupId ? `/?group=${groupId}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window if one is open
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});