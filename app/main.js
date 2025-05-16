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
  const iconPath = path.resolve(__dirname, "assets", "icon.png");
  let iconImage;

  console.log("Attempting to load tray icon from:", iconPath);
  if (fs.existsSync(iconPath)) {
    iconImage = nativeImage.createFromPath(iconPath);
    console.log("Successfully loaded custom tray icon.");
  } else {
    console.warn(
      "Custom tray icon not found at:",
      iconPath,
      ". Using fallback system icon."
    );
    iconImage = nativeImage.createFromNamedImage(
      "NSTouchBarPlayTemplate",
      [-1, 0, 0]
    );
    if (iconImage.isEmpty()) {
      iconImage = nativeImage.createFromNamedImage(
        "NSActionTemplate",
        [-1, 0, 0]
      );
    }
  }

  if (iconImage.isEmpty()) {
    console.error("Failed to load any tray icon. Tray will not be created.");
    return;
  }

  const resizedIcon = iconImage.resize({ width: 18, height: 18 });
  resizedIcon.setTemplateImage(true);

  if (tray) {
    tray.destroy();
  }
  tray = new Tray(resizedIcon);
  tray.setToolTip("MIDI Clock");

  // Event handlers for tray clicks
  tray.on("click", (event, bounds) => {
    console.log("Tray icon left-clicked.");
    const contextMenu = updateTrayMenu(
      bpm,
      clockRunning,
      mainWindow && mainWindow.isVisible()
    );
    if (contextMenu) {
      tray.popUpContextMenu(contextMenu, bounds);
    }
  });

  tray.on("right-click", (event, bounds) => {
    console.log("Tray icon right-clicked.");
    const contextMenu = updateTrayMenu(
      bpm,
      clockRunning,
      mainWindow && mainWindow.isVisible()
    );
    if (contextMenu) {
      tray.popUpContextMenu(contextMenu, bounds);
    }
  });

  // Set initial context menu (primarily for systems that might show it differently)
  updateTrayMenu(bpm, clockRunning, false);
  console.log("Tray icon and menu created successfully.");
}

// Update the tray context menu with current state and RETURN the menu
function updateTrayMenu(currentBpm, currentIsPlaying, isWindowVisible) {
  const contextMenuTemplate = [
    {
      label: `MIDI Clock ${currentIsPlaying ? "Running" : "Stopped"}`,
      enabled: false,
    },
    {
      label: `BPM: ${currentBpm}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: currentIsPlaying ? "Stop Clock" : "Start Clock",
      click: () => {
        if (currentIsPlaying) {
          stopClock();
          if (mainWindow) mainWindow.webContents.send("clock-stopped");
        } else {
          startClock();
          if (mainWindow) mainWindow.webContents.send("clock-started");
        }
      },
    },
    {
      label: "Restart Devices",
      click: () => {
        restartDevices();
        if (mainWindow) mainWindow.webContents.send("clock-restarted");
      },
    },
    { type: "separator" },
    {
      label: "Increase BPM (+)",
      click: () => {
        const newBpm = Math.min(currentBpm + 1, 300);
        updateBPM(newBpm);
        if (mainWindow) mainWindow.webContents.send("bpm-changed", newBpm);
      },
    },
    {
      label: "Decrease BPM (-)",
      click: () => {
        const newBpm = Math.max(currentBpm - 1, 30);
        updateBPM(newBpm);
        if (mainWindow) mainWindow.webContents.send("bpm-changed", newBpm);
      },
    },
    { type: "separator" },
    {
      label: isWindowVisible ? "Hide Controls" : "Show Controls",
      click: () => {
        // Ensure tray is available when getting bounds
        const trayBounds = tray ? tray.getBounds() : null;
        toggleWindow(trayBounds);
      },
    },
    {
      label: "Quit MIDI Clock",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
  if (tray) {
    tray.setContextMenu(contextMenu); // Set as the default for other interactions
  }
  return contextMenu; // Return the menu for explicit use with popUpContextMenu
}

// Create the browser window (the popover)
function createWindow() {
  if (mainWindow) {
    console.log("Main window already exists.");
    return;
  }
  console.log("Creating main window...");
  mainWindow = new BrowserWindow({
    width: 320, // Slightly narrower for a more compact popover
    height: 480, // Adjusted height
    show: false, // Don't show immediately
    frame: false, // No window frame (chromeless)
    fullscreenable: false,
    resizable: false,
    transparent: true, // Allows for rounded corners if CSS is set up
    alwaysOnTop: true, // Keep popover on top
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.js"), // Optional: for secure IPC if needed later
    },
    skipTaskbar: true, // Don't show in the taskbar/dock
    backgroundColor: "#00000000", // Required for transparency to work well with rounded CSS
  });

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "public/index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  mainWindow.on("blur", () => {
    if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
      console.log("Main window lost focus, hiding.");
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    console.log("Main window closed.");
    mainWindow = null;
    // Do not stop clock or close ports here, app lives in tray
  });
  console.log("Main window created.");
}

// Toggle the window visibility
function toggleWindow(bounds) {
  if (!mainWindow) {
    createWindow(); // Ensure window exists
    // Wait for window to be ready before showing, to avoid flash of unstyled content
    mainWindow.once("ready-to-show", () => {
      showWindow(bounds);
    });
    return;
  }

  if (mainWindow.isVisible()) {
    console.log("Window is visible, hiding it.");
    mainWindow.hide();
  } else {
    console.log("Window is hidden, showing it.");
    showWindow(bounds);
  }
}

// Show the window, positioned near the tray icon
function showWindow(trayBounds) {
  if (!mainWindow) {
    console.warn("showWindow called but mainWindow does not exist.");
    createWindow(); // Create it if it doesn't exist
    mainWindow.once("ready-to-show", () => {
      positionAndShow(trayBounds);
    });
    return;
  }
  positionAndShow(trayBounds);
}

function positionAndShow(trayBounds) {
  if (!mainWindow) return;
  const currentTrayBounds =
    trayBounds ||
    (tray ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 });
  const windowBounds = mainWindow.getBounds();

  // Attempt to position window centered below tray icon
  let x = Math.round(
    currentTrayBounds.x + currentTrayBounds.width / 2 - windowBounds.width / 2
  );
  let y = Math.round(currentTrayBounds.y + currentTrayBounds.height + 4); // 4px margin

  // Ensure window is within screen bounds
  const { screen } = require("electron");
  const display = screen.getDisplayNearestPoint({
    x: currentTrayBounds.x,
    y: currentTrayBounds.y,
  });
  const displayBounds = display.workArea;

  if (x < displayBounds.x) x = displayBounds.x;
  if (y < displayBounds.y) y = displayBounds.y; // Should not happen for tray menu
  if (x + windowBounds.width > displayBounds.x + displayBounds.width) {
    x = displayBounds.x + displayBounds.width - windowBounds.width;
  }
  if (y + windowBounds.height > displayBounds.y + displayBounds.height) {
    y = displayBounds.y + displayBounds.height - windowBounds.height;
  }

  mainWindow.setPosition(x, y, false);
  mainWindow.show();
  mainWindow.focus();
  console.log("Window shown and focused at", { x, y });
}

// Prevent the app from quitting when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) {
    // On non-macOS, if not quitting, this usually means user closed last window.
    // For a tray app, we might want to keep it running or quit.
    // For now, let it quit if not macOS and not initiated by menu.
    // app.quit(); // Or keep it running: event.preventDefault();
  } else if (!isQuitting) {
    // On macOS, prevent default behavior of quitting when window closes
    // event.preventDefault(); // Already handled by `isQuitting` logic
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
let tickCount = 0;
let expectedTickTime = 0;
let clockTimerId = null; // For setTimeout

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

// High-precision MIDI clock tick function
function midiTick() {
  if (!clockRunning) return;

  const now = performance.now();
  let nextDelay = 0;

  // Send MIDI Clock pulse
  const sent = sendMIDIMessage([MIDI_CLOCK]);
  if (!sent) {
    console.error(
      "MIDI clock tick: Failed to send MIDI_CLOCK. Attempting to reconnect."
    );
    setupMIDI(); // Attempt to recover MIDI connection
  }

  tickCount++;

  // Calculate the time for the next tick precisely
  const tickIntervalMs = (60 * 1000) / bpm / 24; // 24 PPQN
  expectedTickTime += tickIntervalMs;
  nextDelay = Math.max(0, expectedTickTime - now);

  // Schedule the next tick
  if (clockRunning) {
    clockTimerId = setTimeout(midiTick, nextDelay);
  }
}

// Start MIDI clock
function startClock() {
  if (clockRunning) {
    console.log("Clock already running. Restarting with current BPM.");
    stopClock(); // Stop first to ensure clean restart
  }

  console.log("Starting MIDI clock at BPM:", bpm);

  // Send MIDI Start message to all outputs
  const startSent = sendMIDIMessage([MIDI_START]);

  if (!startSent) {
    console.error("Failed to send MIDI start message - reopening ports");
    setupMIDI(); // Attempt to recover
    if (!sendMIDIMessage([MIDI_START])) {
      console.error(
        "Still failed to send MIDI start after recovery. Clock not starting."
      );
      updateTrayMenu(bpm, false, mainWindow && mainWindow.isVisible()); // Reflect that clock couldn't start
      return;
    }
  }

  clockRunning = true;
  tickCount = 0;
  expectedTickTime = performance.now(); // Initialize expected time for the first tick

  // Start the precise tick loop
  midiTick();

  console.log(
    "MIDI clock started. Tick interval target based on BPM:",
    (60 * 1000) / bpm / 24,
    "ms"
  );
  updateTrayMenu(bpm, true, mainWindow && mainWindow.isVisible());
}

// Stop MIDI clock
function stopClock() {
  if (!clockRunning) return;

  console.log("Stopping MIDI clock");
  clockRunning = false;

  if (clockTimerId) {
    clearTimeout(clockTimerId);
    clockTimerId = null;
  }

  // Send MIDI Stop message to all outputs
  sendMIDIMessage([MIDI_STOP]);
  console.log("Sent MIDI Stop message");
  updateTrayMenu(bpm, false, mainWindow && mainWindow.isVisible());
}

// Continue MIDI clock (Placeholder - a true continue might need more state)
function continueClock() {
  if (clockRunning) return; // Don't continue if already running

  console.log("Continuing MIDI clock at BPM:", bpm);

  // Send MIDI Continue message
  sendMIDIMessage([MIDI_CONTINUE]);

  clockRunning = true;
  // For a true continue, you might need to resume tickCount from where it left off.
  // For simplicity here, we restart the tick generation based on current time.
  expectedTickTime = performance.now();
  midiTick();

  console.log("MIDI clock continued.");
  updateTrayMenu(bpm, true, mainWindow && mainWindow.isVisible());
}

// Update BPM
function updateBPM(newBPM) {
  console.log("Updating BPM from", bpm, "to", newBPM);
  const wasRunning = clockRunning;

  if (wasRunning) {
    stopClock(); // Stop with old BPM timing
  }

  bpm = newBPM;

  if (wasRunning) {
    startClock(); // Restart with new BPM timing
  } else {
    updateTrayMenu(bpm, false, mainWindow && mainWindow.isVisible()); // Update menu if stopped
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
  updateTrayMenu(newBPM, clockRunning, mainWindow && mainWindow.isVisible());
});

ipcMain.on("get-clock-status", (event) => {
  event.returnValue = {
    isRunning: clockRunning,
    currentBPM: bpm,
  };
  // Update tray menu in case window visibility changed
  updateTrayMenu(bpm, clockRunning, mainWindow && mainWindow.isVisible());
});

ipcMain.on("request-clock-status", (event) => {
  event.sender.send("clock-status", {
    isRunning: clockRunning,
    currentBPM: bpm,
  });
  // Update tray menu in case window visibility changed
  updateTrayMenu(bpm, clockRunning, mainWindow && mainWindow.isVisible());
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
