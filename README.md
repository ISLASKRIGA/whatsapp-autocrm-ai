# WhatsApp AutoBot

This is a simple web application to automate WhatsApp replies using `whatsapp-web.js`.

## Features
- **QR Code Login**: Connect your WhatsApp account by scanning a QR code.
- **Automated Replies**: Configure keywords and responses easily.
- **Live Logs**: See incoming messages and automated replies in real-time.

## Setup & Run

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Start the Server**:
    ```bash
    npm start
    ```
3.  **Open the App**:
    Go to [http://localhost:3000](http://localhost:3000) in your browser.

## Troubleshooting
- If the QR code doesn't appear, wait a moment for the server to initialize the browser instance.
- Check the terminal for any error messages.
- Ensure your phone is connected to the internet.

## Note
This uses an unofficial library which relies on running a headless browser. It requires your phone to be connected to the internet.
