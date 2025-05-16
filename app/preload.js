// preload.js
// Used for setting up secure context-isolated IPC if needed in the future.
// For now, it can be empty or used for basic Electron API exposure.

const { contextBridge, ipcRenderer } = require("electron");

// Expose specific ipcRenderer functions to the window if nodeIntegration is false
// and contextIsolation is true. Since we have nodeIntegration:true, this is less critical
// but good practice for future changes.
contextBridge.exposeInMainWorld("electronAPI", {
  sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, func) => {
    // Deliberately strip event as it includes `sender`
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription); // Return a cleanup function
  },
});

console.log("Preload script loaded.");
