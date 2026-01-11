import React, { useState, useEffect } from "react";
import SetupWizard from "./pages/SetupWizard";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

type Page = "setup" | "dashboard" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if app is configured
    window.nuvanaSyncAPI.getConfig().then((config) => {
      setIsConfigured(config.isConfigured);
      if (!config.isConfigured) {
        setCurrentPage("setup");
      }
    });

    // Listen for navigation events from main process
    const unsubscribe = window.nuvanaSyncAPI.onNavigate((path) => {
      if (path === "/settings") {
        setCurrentPage("settings");
      } else if (path === "/dashboard") {
        setCurrentPage("dashboard");
      }
    });

    return unsubscribe;
  }, []);

  const handleSetupComplete = () => {
    setIsConfigured(true);
    setCurrentPage("dashboard");
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
  };

  // Loading state
  if (isConfigured === null) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Render current page
  switch (currentPage) {
    case "setup":
      return <SetupWizard onComplete={handleSetupComplete} />;
    case "settings":
      return <Settings onBack={() => handleNavigate("dashboard")} />;
    case "dashboard":
    default:
      return <Dashboard onNavigate={handleNavigate} />;
  }
}

export default App;
