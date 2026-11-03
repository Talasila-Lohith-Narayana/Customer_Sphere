import { clearDashboardCache } from "./dashboardCache";

const CHANNEL_NAME = "customer-sphere-dashboard-data";
const STORAGE_KEY = "customer-sphere-dashboard-data-change";

let publisher;

function createChannel() {
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") {
    return null;
  }

  return new window.BroadcastChannel(CHANNEL_NAME);
}

export function publishDashboardDataChanged() {
  clearDashboardCache();
  const message = { timestamp: Date.now(), id: Math.random().toString(36).slice(2) };
  publisher ??= createChannel();

  if (publisher) {
    publisher.postMessage(message);
  } else if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  }
}

export function subscribeToDashboardDataChanges(onChange) {
  const activeChannel = createChannel();
  const handleMessage = () => onChange();
  const handleStorage = (event) => {
    if (event.key === STORAGE_KEY && event.newValue) handleMessage();
  };

  if (activeChannel) {
    activeChannel.addEventListener("message", handleMessage);
    return () => {
      activeChannel.removeEventListener("message", handleMessage);
      activeChannel.close();
    };
  } else {
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }
}
