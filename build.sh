#!/bin/bash

echo "Building MIDI Clock Menu Bar App..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Rebuild native modules for Electron
echo "Rebuilding native modules for Electron..."
npx @electron/rebuild

# Build the application
echo "Building the application..."
npm run build

echo "Build complete! Check the dist folder for your application."
echo "You can install it by dragging the MIDI Clock app to your Applications folder."
echo ""
echo "This is now a menu bar app - the app will appear in your menu bar at the top of the screen."
echo "Click the icon to open the interface and control your MIDI devices!" 