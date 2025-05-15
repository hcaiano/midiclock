const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("path");
const url = require("url");
const fs = require("fs");
const midi = require("midi");

// Keep global references to prevent garbage collection
let tray = null;
let mainWindow = null;
let isQuitting = false;

// Create MIDI output
const midiOutput = new midi.Output();

// Set of direct hardware ports
const directOutputs = [];

// Create window when Electron has finished initializing
app.on("ready", () => {
  // Enable detailed console logs for debugging
  enableVerboseLogging();

  // Create tray icon
  createTray();

  // Create the main window but don't show it yet
  createWindow();

  // Attempt to setup the MIDI system
  setupMIDI();
});

// Create the tray icon and menu
function createTray() {
  // Create an icon from the PNG file
  const iconPath = path.join(__dirname, "assets", "icon.png");
  let icon;

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback to a built-in template icon if our icon is missing
    icon = nativeImage.createFromNamedImage("NSTouchBarAudioOutputTemplate");
  }

  // Make the icon smaller to fit in the menu bar
  const smallIcon = icon.resize({ width: 16, height: 16 });
  smallIcon.setTemplateImage(true); // Use template mode for better dark mode support

  // Create the tray icon
  tray = new Tray(smallIcon);
  tray.setToolTip("MIDI Clock");

  // Set up the tray menu
  updateTrayMenu();

  // Show the window when clicking the tray icon
  tray.on("click", () => {
    toggleWindow();
  });
}

// Update the tray context menu with current state
function updateTrayMenu(bpm = 120, isPlaying = false) {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `MIDI Clock ${isPlaying ? "Running" : "Stopped"}`,
      enabled: false,
    },
    {
      label: `BPM: ${bpm}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: isPlaying ? "Stop" : "Start",
      click: () => {
        if (isPlaying) {
          stopClock();
          mainWindow.webContents.send("clock-stopped");
        } else {
          startClock();
          mainWindow.webContents.send("clock-started");
        }
        // Update menu again with new state
        updateTrayMenu(bpm, !isPlaying);
      },
    },
    {
      label: "Restart",
      click: () => {
        restartDevices();
        mainWindow.webContents.send("clock-restarted");
      },
    },
    { type: "separator" },
    {
      label: "BPM +",
      click: () => {
        const newBpm = Math.min(bpm + 1, 300);
        updateBPM(newBpm);
        mainWindow.webContents.send("bpm-changed", newBpm);
        updateTrayMenu(newBpm, isPlaying);
      },
    },
    {
      label: "BPM -",
      click: () => {
        const newBpm = Math.max(bpm - 1, 30);
        updateBPM(newBpm);
        mainWindow.webContents.send("bpm-changed", newBpm);
        updateTrayMenu(newBpm, isPlaying);
      },
    },
    { type: "separator" },
    {
      label: "Show App",
      click: showWindow,
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// Create the browser window
function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 360,
    height: 500,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "MIDI Clock",
    backgroundColor: "#2e2c29",
    skipTaskbar: true,
  });

  // Load the index.html file
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "public/index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // Hide the window when it loses focus
  mainWindow.on("blur", () => {
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });

  // Handle window close event
  mainWindow.on("closed", () => {
    mainWindow = null;
    stopClock();
    // Close all MIDI ports when app closes
    for (const info of directOutputs) {
      if (info.output.isPortOpen()) {
        info.output.closePort();
      }
    }
  });
}

// Toggle the window visibility
function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// Show the window, positioned below the tray icon
function showWindow() {
  if (!mainWindow) {
    createWindow();
  }

  // Position window below the tray icon
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const x = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2
  );
  const y = Math.round(trayBounds.y + trayBounds.height);

  mainWindow.setPosition(x, y, false);
  mainWindow.show();
  mainWindow.focus();
}

// Prevent the app from quitting when all windows are closed
app.on("window-all-closed", (event) => {
  // Keep the app running in the background
  if (!isQuitting) {
    event.preventDefault();
  }
});

// Handle activating the app (clicking on dock icon)
app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  }
  showWindow();
});

// Handle before-quit event to allow graceful shutdown
app.on("before-quit", () => {
  isQuitting = true;
});

// MIDI Clock implementation
let clockRunning = false;
let bpm = 120;
let tickInterval = null;

// MIDI messages
const MIDI_CLOCK = 0xf8;
const MIDI_START = 0xfa;
const MIDI_CONTINUE = 0xfb;
const MIDI_STOP = 0xfc;

// Enable verbose logging for debugging
function enableVerboseLogging() {
  // Redirect console logs to a file for debugging
  const fs = require("fs");
  const path = require("path");
  const logPath = path.join(app.getPath("userData"), "midi-clock-debug.log");

  console.log("Logging debug information to:", logPath);

  // Create log file streams
  const logFile = fs.createWriteStream(logPath, { flags: "w" });

  // Save original console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };

  // Replace console methods to write to file as well
  console.log = function () {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [LOG] ${args.join(" ")}`;

    // Write to file
    logFile.write(message + "\n");

    // Call original method
    originalConsole.log.apply(console, args);
  };

  console.error = function () {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [ERROR] ${args.join(" ")}`;

    // Write to file
    logFile.write(message + "\n");

    // Call original method
    originalConsole.error.apply(console, args);
  };

  console.warn = function () {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [WARN] ${args.join(" ")}`;

    // Write to file
    logFile.write(message + "\n");

    // Call original method
    originalConsole.warn.apply(console, args);
  };

  // Log system info
  console.log("App started");
  console.log("OS:", process.platform, process.arch);
  console.log("Node version:", process.version);
  console.log("Electron version:", process.versions.electron);
}

// Setup the MIDI system
function setupMIDI() {
  try {
    console.log("Setting up MIDI system...");

    // Close any open ports first
    if (midiOutput.isPortOpen()) {
      midiOutput.closePort();
    }

    // Clean up any existing direct outputs
    for (const output of directOutputs) {
      if (output.output.isPortOpen()) {
        output.output.closePort();
      }
    }
    directOutputs.length = 0;

    // Log available MIDI ports
    const portCount = midiOutput.getPortCount();
    console.log(`Found ${portCount} MIDI output ports`);

    for (let i = 0; i < portCount; i++) {
      console.log(`MIDI Port ${i}: ${midiOutput.getPortName(i)}`);
    }

    // First try connecting to each port directly
    const directSuccess = setupDirectPorts();
    console.log("Direct port connection setup result:", directSuccess);

    // Also try the virtual port as a fallback or supplementary approach
    const virtualPortSuccess = setupVirtualPort();
    console.log("Virtual port setup result:", virtualPortSuccess);

    // Final check
    if (directOutputs.length === 0 && !midiOutput.isPortOpen()) {
      console.error("FAILED: No MIDI connections established");
      return false;
    }

    console.log("MIDI system setup complete");
    logMIDIStatus();
    return true;
  } catch (e) {
    console.error("Error setting up MIDI system:", e);
    return false;
  }
}

// Setup direct connections to all available hardware ports
function setupDirectPorts() {
  const portCount = midiOutput.getPortCount();
  console.log(`Setting up direct connections to ${portCount} hardware ports`);

  if (portCount === 0) {
    console.warn("No MIDI ports available for direct connection");
    return false;
  }

  // Create one output per hardware port
  for (let i = 0; i < portCount; i++) {
    try {
      const portName = midiOutput.getPortName(i);

      // Skip non-output ports if they can be identified
      if (portName.includes("HUI") || portName.includes("CTRL")) {
        console.log(`Skipping control/input port ${i}: ${portName}`);
        continue;
      }

      // Special case for TR-8S
      const isTR8S = portName.includes("TR-8S") && !portName.includes("CTRL");

      const output = new midi.Output();
      output.openPort(i);

      // Store port info with the output
      const outputInfo = {
        output: output,
        portId: i,
        portName: portName,
        isTR8S: isTR8S,
      };

      directOutputs.push(outputInfo);
      console.log(`Directly connected to hardware port ${i}: ${portName}`);

      // For debugging, if this is a TR-8S, log more info
      if (isTR8S) {
        console.log(`*** Found TR-8S at port ${i}: ${portName} ***`);
      }
    } catch (e) {
      console.error(`Failed to connect to hardware port ${i}:`, e);
    }
  }

  return directOutputs.length > 0;
}

// Send MIDI message to all outputs
function sendMIDIMessage(message) {
  let sent = false;

  // Send via virtual port if open
  if (midiOutput.isPortOpen()) {
    try {
      midiOutput.sendMessage(message);
      sent = true;
      console.log(
        `Sent MIDI message ${message[0].toString(16)} via virtual port`
      );
    } catch (e) {
      console.error("Failed to send MIDI message via virtual port:", e);
    }
  }

  // Send via direct outputs
  for (const info of directOutputs) {
    if (info.output.isPortOpen()) {
      try {
        info.output.sendMessage(message);
        sent = true;

        // Special logging for TR-8S to debug
        if (info.isTR8S) {
          console.log(`Sent MIDI message ${message[0].toString(16)} to TR-8S`);
        }
      } catch (e) {
        console.error(`Failed to send MIDI message to ${info.portName}:`, e);
      }
    }
  }

  // If sending failed everywhere, try to recover
  if (!sent) {
    console.error(
      "MIDI message sending failed on all outputs. Attempting recovery..."
    );
    setupMIDI();
    return sendMIDIMessage(message); // Try once more after recovery
  }

  return sent;
}

// Start MIDI clock
function startClock() {
  if (clockRunning) {
    stopClock();
  }

  console.log("Starting MIDI clock at BPM:", bpm);

  // Send MIDI Start message to all outputs
  const startSent = sendMIDIMessage([MIDI_START]);

  if (!startSent) {
    console.error("Failed to send MIDI start message - reopening ports");
    setupMIDI();
    sendMIDIMessage([MIDI_START]);
  }

  // Calculate interval in milliseconds
  const intervalMs = Math.floor(60000 / bpm / 24);

  // Start the clock
  clockRunning = true;

  // Use a simple interval for reliability
  tickInterval = setInterval(() => {
    const sent = sendMIDIMessage([MIDI_CLOCK]);

    if (!sent) {
      console.error("Failed to send MIDI clock - attempting to reconnect");
      setupMIDI();
    }
  }, intervalMs);

  console.log("MIDI clock started with interval:", intervalMs, "ms");

  // Update tray menu to reflect running state
  updateTrayMenu(bpm, true);
}

// Stop MIDI clock
function stopClock() {
  if (!clockRunning) return;

  console.log("Stopping MIDI clock");

  clockRunning = false;

  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }

  // Send MIDI Stop message to all outputs
  sendMIDIMessage([MIDI_STOP]);

  // Update tray menu to reflect stopped state
  updateTrayMenu(bpm, false);
}

// Continue MIDI clock
function continueClock() {
  if (clockRunning) return;

  console.log("Continuing MIDI clock at BPM:", bpm);

  // Send MIDI Continue message to all outputs
  sendMIDIMessage([MIDI_CONTINUE]);

  // Calculate interval in milliseconds
  const intervalMs = Math.floor(60000 / bpm / 24);

  // Start the clock
  clockRunning = true;

  // Use a simple interval for reliability
  tickInterval = setInterval(() => {
    sendMIDIMessage([MIDI_CLOCK]);
  }, intervalMs);

  console.log("MIDI clock continued with interval:", intervalMs, "ms");
}

// Update BPM
function updateBPM(newBPM) {
  console.log("Updating BPM from", bpm, "to", newBPM);

  const wasRunning = clockRunning;

  // Stop the clock if it's running
  if (wasRunning) {
    stopClock();
  }

  // Update BPM
  bpm = newBPM;

  // Restart if it was running
  if (wasRunning) {
    startClock();
  } else {
    // Just update the menu if we're not running
    updateTrayMenu(bpm, false);
  }

  console.log("BPM updated to:", bpm);
}

// Get available MIDI ports
function getMidiPorts() {
  const portCount = midiOutput.getPortCount();
  const ports = [];

  for (let i = 0; i < portCount; i++) {
    const portName = midiOutput.getPortName(i);

    // Check if this port is already directly connected
    const connectedOutput = directOutputs.find(
      (info) => info.portId === i || info.portName === portName
    );

    ports.push({
      id: i,
      name: portName,
      connected: !!connectedOutput,
    });
  }

  return ports;
}

// Create virtual MIDI port
function setupVirtualPort() {
  try {
    if (midiOutput.isPortOpen()) {
      midiOutput.closePort();
      console.log("Closed existing virtual MIDI port");
    }

    midiOutput.openVirtualPort("MIDI Clock Output");
    console.log("Virtual MIDI port created successfully");
    return true;
  } catch (e) {
    console.error("Failed to create virtual MIDI port:", e);
    return false;
  }
}

// Log the status of all MIDI connections
function logMIDIStatus() {
  console.log("---------- MIDI CONNECTION STATUS ----------");

  // Check virtual port
  console.log(`Virtual port: ${midiOutput.isPortOpen() ? "OPEN" : "CLOSED"}`);

  // Check direct ports
  console.log(`Direct connections: ${directOutputs.length}`);
  directOutputs.forEach((info, index) => {
    try {
      const isOpen = info.output.isPortOpen();
      console.log(
        `  Port ${info.portId}: ${isOpen ? "OPEN" : "CLOSED"} ${info.portName}`
      );
    } catch (e) {
      console.log(`  Port error:`, e);
    }
  });

  console.log("------------------------------------------");
}

// Restart all connected devices
function restartDevices() {
  console.log("Restarting MIDI devices");

  // If clock is running, stop it first
  if (clockRunning) {
    // Send stop then start in quick succession
    sendMIDIMessage([MIDI_STOP]);
    console.log("Sent MIDI Stop message for restart");

    // Small delay to ensure devices register the stop command
    setTimeout(() => {
      sendMIDIMessage([MIDI_START]);
      console.log("Sent MIDI Start message for restart");
    }, 100);
  } else {
    // If clock isn't running, just send a reset
    sendMIDIMessage([MIDI_STOP]);
    console.log("Sent MIDI Stop message for reset");
  }
}

// IPC event handlers
ipcMain.on("start-clock", () => {
  startClock();
});

ipcMain.on("stop-clock", () => {
  stopClock();
});

ipcMain.on("continue-clock", () => {
  continueClock();
});

ipcMain.on("update-bpm", (event, newBPM) => {
  updateBPM(newBPM);
  // Update tray menu when BPM changes from UI
  updateTrayMenu(newBPM, clockRunning);
});

ipcMain.on("get-clock-status", (event) => {
  event.returnValue = {
    isRunning: clockRunning,
    currentBPM: bpm,
  };
});

ipcMain.on("request-clock-status", (event) => {
  event.sender.send("clock-status", {
    isRunning: clockRunning,
    currentBPM: bpm,
  });
});

ipcMain.on("get-midi-ports", (event) => {
  const ports = getMidiPorts();
  console.log("Available MIDI ports:", ports);
  event.returnValue = ports;
});

ipcMain.on("open-midi-port", (event, portId) => {
  try {
    // Check if we already have this port open directly
    const existingOutput = directOutputs.find((info) => info.portId === portId);

    if (!existingOutput) {
      const portName = midiOutput.getPortName(portId);
      const isTR8S = portName.includes("TR-8S") && !portName.includes("CTRL");

      const output = new midi.Output();
      output.openPort(portId);

      directOutputs.push({
        output: output,
        portId: portId,
        portName: portName,
        isTR8S: isTR8S,
      });

      console.log(`Directly connected to MIDI port ${portId}: ${portName}`);

      if (isTR8S) {
        console.log(
          `*** Manually connected to TR-8S at port ${portId}: ${portName} ***`
        );
      }
    } else {
      console.log(`MIDI port ${portId} is already connected`);
    }

    event.returnValue = true;
  } catch (e) {
    console.error(`Failed to open MIDI port ${portId}:`, e);
    event.returnValue = false;
  }
});

ipcMain.on("close-midi-port", (event, portId) => {
  try {
    // Find the direct output for this port
    const outputIndex = directOutputs.findIndex(
      (info) => info.portId === portId
    );

    if (outputIndex >= 0) {
      const info = directOutputs[outputIndex];
      info.output.closePort();
      directOutputs.splice(outputIndex, 1);
      console.log(`Closed MIDI port: ${info.portName}`);
    }

    if (event) event.returnValue = true;
  } catch (e) {
    console.error(`Failed to close MIDI port:`, e);
    if (event) event.returnValue = false;
  }
});

ipcMain.on("reset-devices", () => {
  restartDevices();
});

ipcMain.on("open-all-midi-ports", (event) => {
  const success = setupMIDI();
  console.log("Set up MIDI system result:", success);
  event.returnValue = success;
});
