const { app, core } = require("photoshop");
const { action } = require("photoshop");
const { imaging } = require("photoshop");
const { storage } = require("uxp");

const DEFAULT_PORT = 9527;
const MAX_PORT = 9537;
const MAX_SIZE = 2048;
const DEBUG_SELECTION_BOUNDS = false;

const storyboardCopilot = {
  serverPort: DEFAULT_PORT,
  isConnected: false,
  pollInterval: null,
  selectionInterval: null,
  reconnectInterval: null,
  lastSelectionBounds: null,
  lastSelectionDocId: null,
  lastSelectionLogKey: null,
  isProcessingCommand: false,

  getServerUrl(port) {
    return `http://localhost:${port || this.serverPort}`;
  },

  showStatus(message, type) {
    const statusEl = document.getElementById("statusMessage");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = "status-message " + type;
      statusEl.style.display = "block";
      
      if (type !== "error") {
        setTimeout(function() {
          statusEl.style.display = "none";
        }, 3000);
      }
    }
  },

  withBusyState: async function(taskName, task) {
    if (this.isProcessingCommand) {
      throw new Error("Photoshop is busy processing another Storyboard Copilot request");
    }

    this.isProcessingCommand = true;
    console.log("Starting task:", taskName);

    try {
      return await task();
    } finally {
      this.isProcessingCommand = false;
      console.log("Finished task:", taskName);
    }
  },

  updateConnectionStatus(connected, port) {
    this.isConnected = connected;
    if (port) this.serverPort = port;
    
    const statusEl = document.getElementById("connectionStatus");
    const sendBtn = document.getElementById("sendSelectionBtn");
    const portInput = document.getElementById("serverPort");
    
    if (statusEl) {
      if (connected) {
        statusEl.className = "status-badge connected";
        statusEl.innerHTML = '<span class="status-dot"></span><span>已连接 (' + this.serverPort + ')</span>';
      } else {
        statusEl.className = "status-badge disconnected";
        statusEl.innerHTML = '<span class="status-dot"></span><span>未连接</span>';
      }
    }
    
    if (sendBtn) {
      sendBtn.disabled = !connected;
    }
    
    if (portInput && connected) {
      portInput.value = this.serverPort;
    }
  },

  tryConnect: async function(port) {
    try {
      const response = await fetch(this.getServerUrl(port) + "/api/ps/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data && data.data.running) {
          const registerResponse = await fetch(this.getServerUrl(port) + "/api/ps/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client: "photoshop" })
          });
          
          if (registerResponse.ok) {
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  },

  scanAndConnect: async function() {
    const portInput = document.getElementById("serverPort");
    const preferredPort = portInput ? parseInt(portInput.value, 10) : DEFAULT_PORT;
    
    if (!isNaN(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535) {
      if (await this.tryConnect(preferredPort)) {
        this.updateConnectionStatus(true, preferredPort);
        this.startPolling();
        return true;
      }
    }
    
    for (let port = DEFAULT_PORT; port <= MAX_PORT; port++) {
      if (port === preferredPort) continue;
      
      if (await this.tryConnect(port)) {
        this.updateConnectionStatus(true, port);
        this.startPolling();
        return true;
      }
    }
    
    this.updateConnectionStatus(false);
    return false;
  },

  startPolling: function() {
    if (this.pollInterval) return;
    
    const self = this;
    console.log("Starting polling on port", this.serverPort);
    let pollCount = 0;
    this.pollInterval = setInterval(async function() {
      pollCount++;
      if (pollCount % 20 === 0) {
        console.log("Poll heartbeat, count:", pollCount, "connected:", self.isConnected);
      }

      if (self.isProcessingCommand) {
        return;
      }
      
      if (!self.isConnected) {
        await self.checkServerStatus();
        return;
      }
      
      try {
        const response = await fetch(self.getServerUrl() + "/api/ps/poll", {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data && result.data.command) {
            console.log("Poll received command:", JSON.stringify(result.data.command, null, 2));
            await self.handleCommand(result.data.command);
          }
        } else {
          console.log("Poll response not ok:", response.status);
          self.updateConnectionStatus(false);
        }
      } catch (error) {
        console.error("Poll error:", error);
        self.updateConnectionStatus(false);
      }
    }, 500);
  },

  stopPolling: function() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  checkServerStatus: async function() {
    try {
      const response = await fetch(this.getServerUrl() + "/api/ps/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data && data.data.running) {
          if (!this.isConnected) {
            const registered = await fetch(this.getServerUrl() + "/api/ps/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ client: "photoshop" })
            });
            
            if (registered.ok) {
              this.updateConnectionStatus(true);
              this.startPolling();
              return true;
            }
          }
          return true;
        }
      }
      this.updateConnectionStatus(false);
      return false;
    } catch (error) {
      this.updateConnectionStatus(false);
      return false;
    }
  },

  handleCommand: async function(command) {
    console.log("handleCommand received:", JSON.stringify(command, null, 2));
    let response = null;
    
    try {
      switch (command.type) {
        case "ping":
          response = { type: "pong" };
          break;
        
        case "getSelection":
          response = await this.getSelectionInfo();
          break;
        
        case "getSelectionImage":
          response = await this.selectionToBase64();
          break;
        
        case "sendImage":
          console.log("Processing sendImage command, data:", command.data ? "has data" : "no data");
          response = await this.fillSelectionWithImage(command.data);
          console.log("fillSelectionWithImage response:", JSON.stringify(response, null, 2));
          break;
        
        default:
          response = { type: "error", error: "Unknown command: " + command.type };
      }
    } catch (error) {
      console.error("handleCommand error:", error);
      response = { type: "error", error: error ? (error.message || error.toString()) : "Unknown error" };
    }
    
    console.log("handleCommand response:", JSON.stringify(response, null, 2));
    
    if (response && command.requestId) {
      console.log("Sending response for requestId:", command.requestId);
      try {
        const resp = await fetch(this.getServerUrl() + "/api/ps/response", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...response,
            requestId: command.requestId
          })
        });
        console.log("Response sent, status:", resp.status);
      } catch (error) {
        console.error("Failed to send response:", error);
      }
    } else {
      console.log("No response or no requestId, response:", response, "requestId:", command.requestId);
    }
  },

  normalizeBoundsValue: function(value) {
    if (value && typeof value === "object" && typeof value._value === "number") {
      return value._value;
    }
    if (typeof value === "number") {
      return value;
    }
    return null;
  },

  extractSelectionBounds: function(selection) {
    if (!selection || typeof selection !== "object" || selection._enum === "none") {
      return null;
    }

    const left = this.normalizeBoundsValue(selection.left);
    const top = this.normalizeBoundsValue(selection.top);
    const right = this.normalizeBoundsValue(selection.right);
    const bottom = this.normalizeBoundsValue(selection.bottom);

    if ([left, top, right, bottom].some((value) => typeof value !== "number")) {
      return null;
    }

    return { left, top, right, bottom };
  },

  getSelectionLogKey: function(docId, bounds) {
    if (!this.isSelectionBoundsValid(bounds)) {
      return `doc:${typeof docId === "number" ? docId : "unknown"}:none`;
    }

    return [
      `doc:${typeof docId === "number" ? docId : "unknown"}`,
      bounds.left,
      bounds.top,
      bounds.right,
      bounds.bottom
    ].join(":");
  },

  logSelectionBoundsIfChanged: function(docId, bounds, rawResult) {
    const nextLogKey = this.getSelectionLogKey(docId, bounds);
    if (nextLogKey === this.lastSelectionLogKey) {
      return;
    }

    this.lastSelectionLogKey = nextLogKey;

    if (DEBUG_SELECTION_BOUNDS) {
      console.log("getSelectionBounds result:", JSON.stringify(rawResult, null, 2));
    }

    if (this.isSelectionBoundsValid(bounds)) {
      console.log("Recorded selection bounds for doc:", docId, bounds);
    } else {
      console.log("Selection cleared for doc:", docId);
    }
  },

  getSelectionBounds: async function() {
    try {
      const doc = this.getActiveDocumentSafe();
      if (!doc) {
        return null;
      }

      const docId = this.getDocumentId(doc);
      const documentTarget = typeof docId === "number"
        ? { _ref: "document", _id: docId }
        : { _ref: "document", _enum: "ordinal", _value: "targetEnum" };

      const result = await action.batchPlay(
        [{
          _obj: "get",
          _target: [{ _property: "selection" }, documentTarget],
          _options: {
            dialogOptions: "dontDisplay"
          }
        }],
        {
          synchronousExecution: true,
          modalBehavior: "execute"
        }
      );

      if (result && result[0] && result[0].selection) {
        const bounds = this.extractSelectionBounds(result[0].selection);
        if (!bounds) {
          this.logSelectionBoundsIfChanged(docId, null, result);
          return null;
        }

        this.lastSelectionBounds = bounds;
        this.lastSelectionDocId = docId;
        this.logSelectionBoundsIfChanged(docId, bounds, result);
        return bounds;
      }

      this.logSelectionBoundsIfChanged(docId, null, result);
      return null;
    } catch (error) {
      console.error("getSelectionBounds error:", error);
      return null;
    }
  },

  getSelectionInfo: async function() {
    try {
      const doc = this.getActiveDocumentSafe();
      if (!doc) {
        return { type: "selectionInfo", hasSelection: false, error: "No active document" };
      }
      
      const bounds = await this.getSelectionBounds();
      if (!bounds) {
        return { type: "selectionInfo", hasSelection: false };
      }
      
      const width = bounds.right - bounds.left;
      const height = bounds.bottom - bounds.top;
      
      return {
        type: "selectionInfo",
        hasSelection: true,
        bounds: bounds,
        width: width,
        height: height,
        documentName: doc.name
      };
    } catch (error) {
      return { type: "selectionInfo", hasSelection: false, error: error.message };
    }
  },

  calculateResizeDimensions: function(width, height, maxSize) {
    const maxDimension = Math.max(width, height);
    if (maxDimension <= maxSize) {
      return { width: width, height: height, scale: 1 };
    }
    const scale = maxSize / maxDimension;
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      scale: scale
    };
  },

  getActiveDocumentSafe: function() {
    try {
      if (app.activeDocument) {
        return app.activeDocument;
      }
    } catch (error) {
      console.warn("Failed to read app.activeDocument directly:", error);
    }

    try {
      if (app.documents && app.documents.length > 0) {
        return app.documents[0];
      }
    } catch (error) {
      console.warn("Failed to inspect app.documents:", error);
    }

    return null;
  },

  getDocumentId: function(doc) {
    if (!doc || typeof doc !== "object") {
      return null;
    }

    if (typeof doc.id === "number") {
      return doc.id;
    }

    if (typeof doc._id === "number") {
      return doc._id;
    }

    return null;
  },

  getLayerId: function(layer) {
    if (!layer || typeof layer !== "object") {
      return null;
    }

    if (typeof layer.id === "number") {
      return layer.id;
    }

    if (typeof layer._id === "number") {
      return layer._id;
    }

    return null;
  },

  getLayerBounds: function(layer) {
    if (!layer || typeof layer !== "object") {
      return null;
    }

    const rawBounds = layer.boundsNoEffects || layer.bounds;
    if (!rawBounds) {
      return null;
    }

    const readValue = function(value) {
      if (value && typeof value === "object" && typeof value._value === "number") {
        return value._value;
      }
      if (typeof value === "number") {
        return value;
      }
      return null;
    };

    const left = readValue(rawBounds.left);
    const top = readValue(rawBounds.top);
    const right = readValue(rawBounds.right);
    const bottom = readValue(rawBounds.bottom);

    if ([left, top, right, bottom].some((value) => typeof value !== "number")) {
      return null;
    }

    return { left, top, right, bottom };
  },

  getFileExtensionFromMimeType: function(mimeType) {
    switch (mimeType) {
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      case "image/bmp":
        return "bmp";
      case "image/tiff":
        return "tif";
      default:
        return "png";
    }
  },

  normalizeIncomingBase64: function(base64Data) {
    if (!base64Data || typeof base64Data !== "string") {
      throw new Error("Missing image base64 data");
    }

    const commaIndex = base64Data.indexOf(",");
    if (base64Data.startsWith("data:") && commaIndex !== -1) {
      return base64Data.substring(commaIndex + 1);
    }

    return base64Data;
  },

  isSelectionBoundsValid: function(bounds) {
    if (!bounds || typeof bounds !== "object") {
      return false;
    }

    return ["left", "top", "right", "bottom"].every((key) => typeof bounds[key] === "number");
  },

  clearSelection: async function() {
    await action.batchPlay(
      [{
        _obj: "set",
        _target: [{
          _ref: "channel",
          _property: "selection"
        }],
        to: {
          _enum: "ordinal",
          _value: "none"
        },
        _options: {
          dialogOptions: "dontDisplay"
        }
      }],
      {
        synchronousExecution: true,
        modalBehavior: "execute"
      }
    );
  },

  restoreSelection: async function(bounds) {
    if (!this.isSelectionBoundsValid(bounds)) {
      return;
    }

    await action.batchPlay(
      [{
        _obj: "set",
        _target: [{
          _ref: "channel",
          _property: "selection"
        }],
        to: {
          _obj: "rectangle",
          top: {
            _unit: "pixelsUnit",
            _value: bounds.top
          },
          left: {
            _unit: "pixelsUnit",
            _value: bounds.left
          },
          bottom: {
            _unit: "pixelsUnit",
            _value: bounds.bottom
          },
          right: {
            _unit: "pixelsUnit",
            _value: bounds.right
          }
        },
        _options: {
          dialogOptions: "dontDisplay"
        }
      }],
      {
        synchronousExecution: true,
        modalBehavior: "execute"
      }
    );
  },

  findLayerById: function(layers, targetLayerId) {
    if (!Array.isArray(layers) || typeof targetLayerId !== "number") {
      return null;
    }

    for (const layer of layers) {
      if (this.getLayerId(layer) === targetLayerId) {
        return layer;
      }

      if (Array.isArray(layer.layers) && layer.layers.length > 0) {
        const nestedLayer = this.findLayerById(layer.layers, targetLayerId);
        if (nestedLayer) {
          return nestedLayer;
        }
      }
    }

    return null;
  },

  transformLayerById: async function(layerId, options) {
    if (typeof layerId !== "number") {
      throw new Error("Missing target layer id for transform");
    }

    const descriptor = {
      _obj: "transform",
      _target: [{
        _ref: "layer",
        _id: layerId
      }],
      freeTransformCenterState: {
        _enum: "quadCenterState",
        _value: "QCSAverage"
      },
      _options: {
        dialogOptions: "dontDisplay"
      },
      _isCommand: true
    };

    if (typeof options.widthPercent === "number") {
      descriptor.width = {
        _unit: "percentUnit",
        _value: options.widthPercent
      };
    }

    if (typeof options.heightPercent === "number") {
      descriptor.height = {
        _unit: "percentUnit",
        _value: options.heightPercent
      };
    }

    if (typeof options.widthPercent === "number" || typeof options.heightPercent === "number") {
      descriptor.linked = false;
    }

    if (typeof options.offsetX === "number" || typeof options.offsetY === "number") {
      descriptor.offset = {
        _obj: "offset",
        horizontal: {
          _unit: "pixelsUnit",
          _value: options.offsetX || 0
        },
        vertical: {
          _unit: "pixelsUnit",
          _value: options.offsetY || 0
        }
      };
    }

    return await action.batchPlay(
      [descriptor],
      {
        synchronousExecution: true,
        modalBehavior: "execute"
      }
    );
  },

  resolveTargetPlacementBounds: async function(targetDoc) {
    const currentBounds = await this.getSelectionBounds();
    if (currentBounds) {
      return currentBounds;
    }

    if (this.lastSelectionBounds && this.lastSelectionDocId === this.getDocumentId(targetDoc)) {
      return { ...this.lastSelectionBounds };
    }

    return null;
  },

  selectionToBase64: async function() {
    return await this.withBusyState("selectionToBase64", async () => {
      try {
        const doc = this.getActiveDocumentSafe();
        if (!doc) {
          return { type: "selectionImage", success: false, error: "No active document" };
        }
        
        const bounds = await this.getSelectionBounds();
        if (!bounds) {
          return { type: "selectionImage", success: false, error: "No selection" };
        }
        
        const originalWidth = Math.round(bounds.right - bounds.left);
        const originalHeight = Math.round(bounds.bottom - bounds.top);
        const dims = this.calculateResizeDimensions(originalWidth, originalHeight, MAX_SIZE);
        const targetWidth = dims.width;
        const targetHeight = dims.height;
        const scale = dims.scale;
        const documentId = this.getDocumentId(doc);
        let imageData = null;
        
        await core.executeAsModal(async function() {
          const sourceBounds = {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom
          };
          
          const targetSize = {
            width: targetWidth,
            height: targetHeight
          };
          
          const pixelOptions = {
            sourceBounds: sourceBounds,
            targetSize: targetSize,
            colorSpace: "RGB",
            applyAlpha: true
          };

          if (typeof documentId === "number") {
            pixelOptions.documentID = documentId;
          }

          const pixelResult = await imaging.getPixels(pixelOptions);
          
          const jpegData = await imaging.encodeImageData({
            imageData: pixelResult.imageData,
            base64: true
          });
          
          pixelResult.imageData.dispose();
          
          imageData = {
            base64: jpegData,
            width: targetWidth,
            height: targetHeight,
            originalWidth: originalWidth,
            originalHeight: originalHeight,
            scale: scale
          };
          
        }, { "commandName": "storyboard_export_selection" });
        
        return {
          type: "selectionImage",
          success: true,
          data: imageData
        };
        
      } catch (error) {
        console.error("selectionToBase64 error:", error);
        return {
          type: "selectionImage",
          success: false,
          error: error ? (error.message || error.toString()) : "Unknown error"
        };
      }
    });
  },

  fillSelectionWithImage: async function(imageData) {
    return await this.withBusyState("fillSelectionWithImage", async () => {
      let tempFile = null;

      try {
        console.log("fillSelectionWithImage called with:", imageData.width, "x", imageData.height);
        console.log("Base64 length:", imageData.base64 ? imageData.base64.length : 0);
        
        const targetDoc = this.getActiveDocumentSafe();
        if (!targetDoc) {
          console.error("No active document");
          return { type: "sendImageResult", success: false, error: "No active document" };
        }

        const currentSelectionBounds = await this.getSelectionBounds();
        const targetBounds = currentSelectionBounds
          || await this.resolveTargetPlacementBounds(targetDoc);
        const shouldRestoreSelection = this.isSelectionBoundsValid(currentSelectionBounds);
        const targetDocId = this.getDocumentId(targetDoc);
        console.log("Target bounds:", JSON.stringify(targetBounds));
        console.log("Target document:", targetDoc.name, "width:", targetDoc.width, "height:", targetDoc.height);

        const self = this;
        const pureBase64 = this.normalizeIncomingBase64(imageData.base64);
        const binaryString = atob(pureBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const extension = this.getFileExtensionFromMimeType(imageData.mimeType || "image/png");
        const tempFolder = await storage.localFileSystem.getTemporaryFolder();
        tempFile = await tempFolder.createFile("storyboard_import_" + Date.now() + "." + extension, {
          overwrite: true
        });
        await tempFile.write(bytes, { format: storage.formats.binary });
        console.log("Temp import file written:", tempFile.name);

        const sessionToken = await storage.localFileSystem.createSessionToken(tempFile);

        await core.executeAsModal(async function() {
          let selectionCleared = false;

          try {
            if (shouldRestoreSelection) {
              console.log("Temporarily clearing selection before placing image...");
              await self.clearSelection();
              selectionCleared = true;
            }

            console.log("Placing image into active document...");
            const placeResult = await action.batchPlay(
              [{
                _obj: "placeEvent",
                null: {
                  _path: sessionToken,
                  _kind: "local"
                },
                freeTransformCenterState: {
                  _enum: "quadCenterState",
                  _value: "QCSAverage"
                },
                offset: {
                  _obj: "offset",
                  horizontal: {
                    _unit: "pixelsUnit",
                    _value: 0
                  },
                  vertical: {
                    _unit: "pixelsUnit",
                    _value: 0
                  }
                },
                _isCommand: true,
                _options: {
                  dialogOptions: "dontDisplay"
                }
              }],
              {
                synchronousExecution: true,
                modalBehavior: "execute"
              }
            );

            console.log("placeEvent result:", JSON.stringify(placeResult, null, 2));

            const placedLayerId = placeResult
              && placeResult[0]
              && typeof placeResult[0].ID === "number"
              ? placeResult[0].ID
              : null;

            let placedLayer = null;
            if (placedLayerId !== null) {
              placedLayer = self.findLayerById(targetDoc.layers, placedLayerId);
            }
            if (!placedLayer && Array.isArray(targetDoc.activeLayers) && targetDoc.activeLayers[0]) {
              placedLayer = targetDoc.activeLayers[0];
            }
            if (!placedLayer && targetDoc.activeLayer) {
              placedLayer = targetDoc.activeLayer;
            }
            if (!placedLayer) {
              throw new Error("Failed to resolve placed layer after import");
            }

            try {
              if (placedLayer.name !== "Storyboard Copilot Import") {
                placedLayer.name = "Storyboard Copilot Import";
              }
            } catch (renameError) {
              console.warn("Failed to rename placed layer:", renameError);
            }

            const resolvedPlacedLayerId = placedLayerId !== null
              ? placedLayerId
              : self.getLayerId(placedLayer);

            let currentBounds = self.getLayerBounds(placedLayer);
            console.log("Placed layer bounds:", JSON.stringify(currentBounds));

            if (targetBounds && currentBounds) {
              const sourceWidth = Math.max(1, currentBounds.right - currentBounds.left);
              const sourceHeight = Math.max(1, currentBounds.bottom - currentBounds.top);
              const targetWidth = Math.max(1, Math.round(targetBounds.right - targetBounds.left));
              const targetHeight = Math.max(1, Math.round(targetBounds.bottom - targetBounds.top));

              const scaleX = (targetWidth / sourceWidth) * 100;
              const scaleY = (targetHeight / sourceHeight) * 100;
              console.log("Resizing placed layer via transform:", scaleX, scaleY, "layerId:", resolvedPlacedLayerId);
              await self.transformLayerById(resolvedPlacedLayerId, {
                widthPercent: scaleX,
                heightPercent: scaleY
              });

              if (resolvedPlacedLayerId !== null) {
                const refreshedLayerAfterResize = self.findLayerById(targetDoc.layers, resolvedPlacedLayerId);
                if (refreshedLayerAfterResize) {
                  placedLayer = refreshedLayerAfterResize;
                }
              }

              currentBounds = self.getLayerBounds(placedLayer);
              console.log("Bounds after resize:", JSON.stringify(currentBounds));

              if (currentBounds) {
                const deltaX = Math.round(targetBounds.left - currentBounds.left);
                const deltaY = Math.round(targetBounds.top - currentBounds.top);
                console.log("Translating placed layer via transform:", deltaX, deltaY, "layerId:", resolvedPlacedLayerId);
                await self.transformLayerById(resolvedPlacedLayerId, {
                  offsetX: deltaX,
                  offsetY: deltaY
                });

                if (resolvedPlacedLayerId !== null) {
                  const refreshedLayerAfterMove = self.findLayerById(targetDoc.layers, resolvedPlacedLayerId);
                  if (refreshedLayerAfterMove) {
                    placedLayer = refreshedLayerAfterMove;
                  }
                }

                console.log("Bounds after translate:", JSON.stringify(self.getLayerBounds(placedLayer)));
              }
            }

            try {
              if (Array.isArray(targetDoc.activeLayers)) {
                targetDoc.activeLayers = [placedLayer];
              } else {
                targetDoc.activeLayer = placedLayer;
              }
            } catch (activateLayerError) {
              console.warn("Failed to activate placed layer:", activateLayerError);
            }

            console.log("Image inserted into active document successfully", {
              targetDocId: targetDocId,
              hasSelection: Boolean(targetBounds),
              usedPlacedLayerId: placedLayerId
            });
          } finally {
            if (selectionCleared) {
              try {
                console.log("Restoring original selection after image placement...");
                await self.restoreSelection(currentSelectionBounds);
              } catch (restoreError) {
                console.warn("Failed to restore selection:", restoreError);
              }
            }
          }
        }, { "commandName": "storyboard_import_image" });

        if (tempFile) {
          try {
            await tempFile.delete();
            tempFile = null;
          } catch (cleanupError) {
            console.warn("Failed to delete temp import file:", cleanupError);
          }
        }

        console.log("fillSelectionWithImage completed successfully");
        return { type: "sendImageResult", success: true };
        
      } catch (error) {
        console.error("fillSelectionWithImage error:", error);
        console.error("Error stack:", error ? error.stack : "no stack");
        if (tempFile) {
          try {
            await tempFile.delete();
          } catch (cleanupError) {
            console.error("Failed to delete temp import file:", cleanupError);
          }
        }
        return {
          type: "sendImageResult",
          success: false,
          error: error ? (error.message || error.toString()) : "Unknown error"
        };
      }
    });
  },

  sendSelectionToCanvas: function() {
    if (this.isProcessingCommand) {
      this.showStatus("Photoshop 忙碌中，请稍后再试", "error");
      return;
    }
    if (!this.isConnected) {
      this.showStatus("未连接到服务器", "error");
      return;
    }
    
    this.showStatus("正在发送选区到画布...", "info");
    
    const self = this;
    this.selectionToBase64().then(async function(result) {
      if (result.success && result.data) {
        try {
          const response = await fetch(self.getServerUrl() + "/api/ps/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result.data)
          });
          
          if (response.ok) {
            self.showStatus("图像已发送到画布", "success");
          } else {
            self.showStatus("发送失败", "error");
          }
        } catch (error) {
          self.showStatus("发送失败: " + error.message, "error");
        }
      } else {
        self.showStatus("导出失败: " + result.error, "error");
      }
    });
  },

  updateSelectionDisplay: function() {
    const infoEl = document.getElementById("selectionInfo");
    if (!infoEl) return;
    if (this.isProcessingCommand) return;
    
    const self = this;
    this.getSelectionInfo().then(function(info) {
      if (!info.hasSelection) {
        infoEl.innerHTML = "<p>选区信息：" + (info.error || "无选区") + "</p>";
      } else {
        const needsResize = Math.max(info.width, info.height) > MAX_SIZE;
        let html = "<p>选区信息：</p><ul>";
        html += "<li>宽度: " + info.width.toFixed(0) + " px</li>";
        html += "<li>高度: " + info.height.toFixed(0) + " px</li>";
        html += "<li>位置: (" + info.bounds.left.toFixed(0) + ", " + info.bounds.top.toFixed(0) + ")</li>";
        if (needsResize) {
          html += '<li style="color: #f59e0b;">⚠ 尺寸超过 2K，将自动压缩至 ' + MAX_SIZE + 'px</li>';
        }
        html += "</ul>";
        infoEl.innerHTML = html;
      }
    });
  },

  escapeHtml: function(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  updateConnectionStatus: function(connected, port) {
    this.isConnected = connected;
    if (port) this.serverPort = port;

    const statusEl = document.getElementById("connectionStatus");
    const sendBtn = document.getElementById("sendSelectionBtn");
    const portInput = document.getElementById("serverPort");

    if (statusEl) {
      if (connected) {
        statusEl.className = "status-badge connected";
        statusEl.innerHTML = '<span class="status-dot"></span><span>已连接 ' + this.serverPort + '</span>';
      } else {
        statusEl.className = "status-badge disconnected";
        statusEl.innerHTML = '<span class="status-dot"></span><span>未连接</span>';
      }
    }

    if (sendBtn) {
      sendBtn.disabled = !connected;
    }

    if (portInput && connected) {
      portInput.value = this.serverPort;
    }
  },

  updateSelectionDisplay: function() {
    const infoEl = document.getElementById("selectionInfo");
    if (!infoEl) return;
    if (this.isProcessingCommand) return;

    const self = this;
    this.getSelectionInfo().then(function(info) {
      if (!info.hasSelection) {
        infoEl.innerHTML = [
          '<div class="selection-header">',
          '<span class="selection-title">选区信息</span>',
          '</div>',
          '<div class="selection-empty">',
          self.escapeHtml(info.error || "未检测到选区"),
          '</div>'
        ].join("");
        return;
      }

      const needsResize = Math.max(info.width, info.height) > MAX_SIZE;
      let html = '<div class="selection-header">';
      html += '<span class="selection-title">当前选区</span>';
      if (needsResize) {
        html += '<span class="info-chip warning">自动压缩至 2K</span>';
      }
      html += '</div>';
      html += '<div class="selection-grid">';
      html += '<div class="selection-item"><span class="selection-key">宽度</span><span class="selection-value">' + info.width.toFixed(0) + ' px</span></div>';
      html += '<div class="selection-item"><span class="selection-key">高度</span><span class="selection-value">' + info.height.toFixed(0) + ' px</span></div>';
      html += '<div class="selection-item"><span class="selection-key">X</span><span class="selection-value">' + info.bounds.left.toFixed(0) + '</span></div>';
      html += '<div class="selection-item"><span class="selection-key">Y</span><span class="selection-value">' + info.bounds.top.toFixed(0) + '</span></div>';
      if (info.documentName) {
        html += '<div class="selection-item full"><span class="selection-key">文档</span><span class="selection-value">' + self.escapeHtml(info.documentName) + '</span></div>';
      }
      html += '</div>';
      infoEl.innerHTML = html;
    });
  },

  renderPanelLegacy: function(root) {
    const container = document.createElement("div");
    container.className = "container";
    
    const header = document.createElement("div");
    header.className = "header";
    
    const title = document.createElement("h1");
    title.textContent = "Storyboard Copilot";
    header.appendChild(title);
    
    const statusBadge = document.createElement("div");
    statusBadge.id = "connectionStatus";
    statusBadge.className = "status-badge disconnected";
    statusBadge.innerHTML = '<span class="status-dot"></span><span>未连接</span>';
    header.appendChild(statusBadge);
    
    container.appendChild(header);
    
    const portSection = document.createElement("div");
    portSection.className = "section";
    
    const portLabel = document.createElement("label");
    portLabel.className = "label";
    portLabel.textContent = "服务器端口";
    portSection.appendChild(portLabel);
    
    const portInput = document.createElement("input");
    portInput.type = "number";
    portInput.id = "serverPort";
    portInput.className = "input";
    portInput.value = this.serverPort;
    portInput.min = "9527";
    portInput.max = "9537";
    portSection.appendChild(portInput);
    
    container.appendChild(portSection);
    
    const testBtnSection = document.createElement("div");
    testBtnSection.className = "section";
    
    const testBtn = document.createElement("button");
    testBtn.id = "testConnectionBtn";
    testBtn.className = "button secondary";
    testBtn.textContent = "测试连接";
    testBtnSection.appendChild(testBtn);
    
    container.appendChild(testBtnSection);
    
    const infoSection = document.createElement("div");
    infoSection.className = "section";
    
    const infoBox = document.createElement("div");
    infoBox.id = "selectionInfo";
    infoBox.className = "info-box";
    infoBox.innerHTML = "<p>选区信息：检测中...</p>";
    infoSection.appendChild(infoBox);
    
    container.appendChild(infoSection);
    
    const sendBtnSection = document.createElement("div");
    sendBtnSection.className = "section";
    
    const sendBtn = document.createElement("button");
    sendBtn.id = "sendSelectionBtn";
    sendBtn.className = "button primary";
    sendBtn.textContent = "发送选区到画布";
    sendBtn.disabled = true;
    sendBtnSection.appendChild(sendBtn);
    
    container.appendChild(sendBtnSection);
    
    const statusMessage = document.createElement("div");
    statusMessage.id = "statusMessage";
    statusMessage.className = "status-message";
    statusMessage.style.display = "none";
    container.appendChild(statusMessage);
    
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.innerHTML = "<p>提示：从画布发送图像时，PS 会自动接收并填充到当前选区</p>";
    container.appendChild(hint);
    
    root.appendChild(container);
    
    this.setupEventListeners();
  },

  renderPanel: function(root) {
    const container = document.createElement("div");
    container.className = "container";

    const hero = document.createElement("div");
    hero.className = "hero-card";

    const header = document.createElement("div");
    header.className = "header";

    const headerCopy = document.createElement("div");
    headerCopy.className = "header-copy";

    const title = document.createElement("h1");
    title.textContent = "Storyboard Copilot";
    headerCopy.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.className = "header-subtitle";
    subtitle.textContent = "PS \u2194 Storyboard \u540c\u6b65";
    headerCopy.appendChild(subtitle);

    header.appendChild(headerCopy);

    const statusBadge = document.createElement("div");
    statusBadge.id = "connectionStatus";
    statusBadge.className = "status-badge disconnected";
    statusBadge.innerHTML = '<span class="status-dot"></span><span>\u672a\u8fde\u63a5</span>';
    header.appendChild(statusBadge);

    hero.appendChild(header);
    container.appendChild(hero);

    const portSection = document.createElement("div");
    portSection.className = "section section-card compact-block";

    const portLabel = document.createElement("label");
    portLabel.className = "label";
    portLabel.textContent = "\u670d\u52a1\u5668\u7aef\u53e3";
    portSection.appendChild(portLabel);

    const inputShell = document.createElement("div");
    inputShell.className = "input-shell";

    const portInput = document.createElement("input");
    portInput.type = "number";
    portInput.id = "serverPort";
    portInput.className = "input";
    portInput.value = this.serverPort;
    portInput.min = "9527";
    portInput.max = "9537";
    inputShell.appendChild(portInput);
    portSection.appendChild(inputShell);

    const testBtn = document.createElement("button");
    testBtn.id = "testConnectionBtn";
    testBtn.className = "button secondary";
    testBtn.textContent = "\u6d4b\u8bd5\u8fde\u63a5";
    portSection.appendChild(testBtn);

    container.appendChild(portSection);

    const infoSection = document.createElement("div");
    infoSection.className = "section section-card selection-card compact-block";

    const infoBox = document.createElement("div");
    infoBox.id = "selectionInfo";
    infoBox.className = "info-box";
    infoBox.innerHTML = "<p>\u9009\u533a\u4fe1\u606f\uff1a\u68c0\u6d4b\u4e2d...</p>";
    infoSection.appendChild(infoBox);

    container.appendChild(infoSection);

    const sendBtnSection = document.createElement("div");
    sendBtnSection.className = "section section-card action-card compact-block";

    const sendBtn = document.createElement("button");
    sendBtn.id = "sendSelectionBtn";
    sendBtn.className = "button primary action-button";
    sendBtn.textContent = "\u53d1\u9001\u9009\u533a\u5230\u753b\u5e03";
    sendBtn.disabled = true;
    sendBtnSection.appendChild(sendBtn);

    const statusMessage = document.createElement("div");
    statusMessage.id = "statusMessage";
    statusMessage.className = "status-message";
    statusMessage.style.display = "none";
    sendBtnSection.appendChild(statusMessage);

    container.appendChild(sendBtnSection);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.innerHTML = "<p>\u63d0\u793a\uff1a\u4ece\u753b\u5e03\u53d1\u9001\u56fe\u50cf\u65f6\uff0cPS \u4f1a\u81ea\u52a8\u63a5\u6536\u5e76\u586b\u5145\u5230\u5f53\u524d\u9009\u533a</p>";
    container.appendChild(hint);

    root.appendChild(container);

    this.setupEventListeners();
  },

  setupEventListeners: function() {
    const testBtn = document.getElementById("testConnectionBtn");
    const sendBtn = document.getElementById("sendSelectionBtn");
    const portInput = document.getElementById("serverPort");
    
    const self = this;
    
    if (testBtn) {
      testBtn.addEventListener("click", async function() {
        self.showStatus("正在扫描端口并连接...", "info");
        const connected = await self.scanAndConnect();
        if (connected) {
          self.showStatus("连接成功 (端口: " + self.serverPort + ")", "success");
        } else {
          self.showStatus("连接失败，请确保服务器已启动", "error");
        }
      });
    }
    
    if (sendBtn) {
      sendBtn.addEventListener("click", function() {
        self.sendSelectionToCanvas();
      });
    }
    
    if (portInput) {
      portInput.addEventListener("change", function(e) {
        const newPort = parseInt(e.target.value, 10);
        if (!isNaN(newPort) && newPort >= 1024 && newPort <= 65535) {
          self.serverPort = newPort;
        }
      });
    }
  },

  startAutoRefresh: function() {
    const self = this;
    this.selectionInterval = setInterval(function() {
      self.updateSelectionDisplay();
    }, 1000);
    
    this.scanAndConnect().then(function(connected) {
      if (connected) {
        self.showStatus("已自动连接 (端口: " + self.serverPort + ")", "success");
      }
    });
    
    this.reconnectInterval = setInterval(function() {
      if (!self.isConnected) {
        self.scanAndConnect();
      }
    }, 5000);
  },

  stopAutoRefresh: function() {
    if (this.selectionInterval) {
      clearInterval(this.selectionInterval);
      this.selectionInterval = null;
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  },

  stopAll: function() {
    this.stopAutoRefresh();
    this.stopPolling();
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.storyboardCopilot = storyboardCopilot;
}
