import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

try {
  window.localStorage.removeItem("jurisguard_profile_images");
} catch {
  // Ignore unavailable storage; profile images are no longer stored in browser storage.
} 

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <Toaster
        position="bottom-right"
        reverseOrder={true}
        containerStyle={{ zIndex: 11000 }}
        toastOptions={{ style: { zIndex: 11000 } }}
      />
    </AuthProvider>
  </React.StrictMode>
);

