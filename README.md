# MIDI Clock

A simple, lightweight MIDI Clock application for macOS that allows you to synchronize all your MIDI devices without opening a DAW.

## Features

- Send MIDI clock signals to all connected MIDI devices automatically
- Support for both standard MIDI and MIDI over USB devices
- Adjustable BPM (30-300)
- Start, stop, and reset controls
- Virtual port for connecting to all devices at once
- Toggle individual devices on/off
- Keyboard shortcuts (Space to start/stop)
- Visual pulse feedback
- Plug-and-play: opens ready to use with all devices connected

## Screenshots

![MIDI Clock App Screenshot](screenshot.png)

## Requirements

- macOS
- Node.js 14 or higher (for development only)

## Quick Start

1. Download the MIDI Clock.dmg file from the releases
2. Mount the DMG and drag the app to your Applications folder
3. Double-click to launch - all your MIDI devices will be connected automatically
4. Set your BPM and click Start to begin

## Development

### Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm start` to start the application in development mode

### Building from Source

To build the application from source:

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npx @electron/rebuild

# Build the application
npm run build
```

The built application will be available in the `dist` folder.

## Usage

1. Launch the application - all MIDI devices will be connected automatically
2. Adjust the BPM using the slider or +/- buttons
3. Click "Start" to begin sending MIDI clock signals
4. Use toggle switches to enable/disable specific devices
5. Use "Reset" to resynchronize if any device loses sync

## Keyboard Shortcuts

- Space: Start/Stop

## License

This project is licensed under the MIT License - see the LICENSE file for details.
