"use strict";

require("@smartspectra/node-sdk/preload");

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("signalSessionConfig", {
  getApiKey: () => process.env.PRESAGE_API_KEY || "",
});
