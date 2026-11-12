"use strict";

const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(ROOT, ".env") });

const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, session } = require("electron");
const { bindSmartSpectraIpc } = require("@smartspectra/node-sdk/main");

const RENDERER_ROOT = path.join(ROOT, "src", "renderer");
const PORT = Number(process.env.SIGNAL_SESSION_PORT || 8765);
const APP_URL = `http://127.0.0.1:${PORT}`;
const PYTHON = process.env.PYTHON_EXECUTABLE || (process.platform === "win32" ? "python" : "python3");

let pythonServer;
let pythonError;

function startPythonServer() {
  const serverPath = path.join(ROOT, "backend", "server.py");
  pythonServer = spawn(PYTHON, [serverPath, "--port", String(PORT)], {
    cwd: RENDERER_ROOT,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  pythonServer.on("error", (error) => {
    pythonError = error;
  });
}

async function waitForPythonServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (pythonError) throw new Error(`Could not start Python (${PYTHON}): ${pythonError.message}`);
    if (pythonServer.exitCode !== null) {
      throw new Error(`Python server exited with status ${pythonServer.exitCode}.`);
    }
    try {
      const response = await fetch(`${APP_URL}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Python server did not become ready at ${APP_URL}.`);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 850,
    minHeight: 650,
    backgroundColor: "#f5f6f4",
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  bindSmartSpectraIpc(window);

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_URL}/`)) event.preventDefault();
  });
  window.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  startPythonServer();
  await waitForPythonServer();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details?.requestingUrl || webContents.getURL();
    const mediaTypes = details?.mediaTypes || [];
    const videoOnly = mediaTypes.length === 1 && mediaTypes[0] === "video";
    callback(permission === "media" && videoOnly && url.startsWith(`${APP_URL}/`));
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error("Could not start Signal Session.", error);
  dialog.showErrorBox("Signal Session could not start", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (pythonServer && pythonServer.exitCode === null) pythonServer.kill();
});
