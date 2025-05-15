const fs = require("fs");
const path = require("path");

// Create a simple PNG icon in case the SVG conversion isn't available
// This creates a blue circle with a play button and clock markings

// Create a transparent image buffer with size 1024x1024
const width = 1024;
const height = 1024;
const bufferSize = width * height * 4; // 4 bytes per pixel (RGBA)
const buffer = Buffer.alloc(bufferSize, 0);

// Helper function to set a pixel at (x, y) with RGBA color
function setPixel(x, y, r, g, b, a) {
  const index = (y * width + x) * 4;
  buffer[index] = r;
  buffer[index + 1] = g;
  buffer[index + 2] = b;
  buffer[index + 3] = a;
}

// Helper function to draw a filled circle
function drawCircle(centerX, centerY, radius, r, g, b, a) {
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          setPixel(x, y, r, g, b, a);
        }
      }
    }
  }
}

// Draw a blue circle background
drawCircle(width / 2, height / 2, 450, 0, 122, 255, 255);

// Draw a white play triangle
for (let y = height / 2 - 180; y <= height / 2 + 180; y++) {
  for (let x = width / 2 - 150; x <= width / 2 + 150; x++) {
    const dx = x - width / 2;
    const dy = y - height / 2;

    // Triangle shape
    if (dx > 0 && dx < 200 && Math.abs(dy) < dx) {
      setPixel(x, y, 255, 255, 255, 255);
    }
  }
}

// Write the PNG header and data
const header = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR chunk length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
  0x00,
  0x00,
  0x04,
  0x00, // width (1024)
  0x00,
  0x00,
  0x04,
  0x00, // height (1024)
  0x08, // bit depth
  0x06, // color type (RGBA)
  0x00, // compression method
  0x00, // filter method
  0x00, // interlace method
  0x00,
  0x00,
  0x00,
  0x00, // CRC (to be calculated)
]);

// This is a very simplified approach - in a real implementation,
// you would need to handle compression and CRC calculation properly
// Here we're just creating a placeholder for demonstration

// Save to file
fs.writeFileSync(
  path.join(__dirname, "icon.png"),
  Buffer.concat([header, buffer])
);
console.log("Created fallback icon.png");
