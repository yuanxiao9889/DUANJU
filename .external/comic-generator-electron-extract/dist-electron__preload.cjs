
"use strict";
const require$$0 = require("electron");
var preload = {};
var hasRequiredPreload;
function requirePreload() {
  if (hasRequiredPreload) return preload;
  hasRequiredPreload = 1;
  const { contextBridge, ipcRenderer } = require$$0;
  contextBridge.exposeInMainWorld("electronAPI", {
    // 获取保存路径
    getSavePath: () => ipcRenderer.invoke("get-save-path"),
    // 保存生成的图片
    saveImage: (imageUrl, taskId, filename) => ipcRenderer.invoke("save-image", { imageUrl, taskId, filename }),
    // 保存上传的图片
    saveUploadedImage: (dataUrl, characterName) => ipcRenderer.invoke("save-uploaded-image", { dataUrl, characterName }),
    // 打开文件选择对话框
    openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
    // 打开文件夹
    openFolder: (folderType) => ipcRenderer.invoke("open-folder", folderType),
    // 批量保存图片
    saveImagesBatch: (images) => ipcRenderer.invoke("save-images-batch", { images }),
    // 显示另存为对话框
    showSaveDialog: (defaultFilename, filters) => ipcRenderer.invoke("show-save-dialog", { defaultFilename, filters }),
    // 下载文件到指定路径
    downloadFileToPath: (sourceUrl, savePath) => ipcRenderer.invoke("download-file-to-path", { sourceUrl, savePath }),
    // 下载图片到指定路径（兼容旧接口）
    downloadImageToPath: (imageUrl, savePath) => ipcRenderer.invoke("download-file-to-path", { sourceUrl: imageUrl, savePath }),
    // 选择角色图库文件夹（支持默认路径）
    selectCharacterFolder: (defaultPath) => ipcRenderer.invoke("select-character-folder", defaultPath),
    // 读取角色图库图片
    readCharacterImages: (folderPath) => ipcRenderer.invoke("read-character-images", { folderPath }),
    // 选择场景图库文件夹
    selectSceneFolder: () => ipcRenderer.invoke("select-scene-folder"),
    // 读取场景图库图片
    readSceneImages: (folderPath) => ipcRenderer.invoke("read-scene-images", { folderPath }),
    // 打开文件路径
    openPath: (folderPath) => ipcRenderer.invoke("open-path", folderPath),
    // 在文件夹中显示文件
    showItemInFolder: (filePath) => ipcRenderer.invoke("show-item-in-folder", filePath),
    // 准备可拖拽到外部应用的视频文件
    prepareVideoDragSource: (videoUrl, filename) => ipcRenderer.invoke("prepare-video-drag-source", { videoUrl, filename }),
    // 启动原生文件拖拽
    startVideoDrag: (filePath) => ipcRenderer.send("start-video-drag", { filePath }),
    // 🔥 读取本地文件并返回 data URL（用于加载本地图片/视频）
    readLocalFileAsDataUrl: (filePath) => ipcRenderer.invoke("read-local-file-as-data-url", { filePath }),
    // 获取本地资源轻量指纹（路径+大小+mtime）
    getLocalFileFingerprint: (filePath) => ipcRenderer.invoke("get-local-file-fingerprint", { filePath }),
    // 保存图片到指定文件夹
    saveImageToFolder: (imageUrl, folderPath, filename, createDateFolder) => ipcRenderer.invoke("save-image-to-folder", { imageUrl, folderPath, filename, createDateFolder }),
    // 保存图片到本地应用目录（返回 local-image:// URL）
    saveImageToLocal: async (imageData, folderName, filename) => {
      const result = await ipcRenderer.invoke("save-image-to-local", { imageData, folderName, filename });
      return (result == null ? void 0 : result.url) || (result == null ? void 0 : result.path) || null;
    },
    // 🎬 保存视频到指定文件夹
    saveVideoToFolder: (videoUrl, folderPath, filename, createDateFolder) => ipcRenderer.invoke("save-video-to-folder", { videoUrl, folderPath, filename, createDateFolder }),
    // 读取任务数据文件
    readTasksFile: (filePath) => ipcRenderer.invoke("read-tasks-file", { filePath }),
    // 写入任务数据文件
    writeTasksFile: (data, filePath) => ipcRenderer.invoke("write-tasks-file", { data, filePath }),
    // 选择任务数据文件路径
    selectTasksFilePath: () => ipcRenderer.invoke("select-tasks-file-path"),
    // 获取默认任务文件路径
    getDefaultTasksFilePath: () => ipcRenderer.invoke("get-default-tasks-file-path"),
    // 项目管理相关
    readProjectsFile: () => ipcRenderer.invoke("read-projects-file"),
    writeProjectsFile: (data) => ipcRenderer.invoke("write-projects-file", { data }),
    readProjectTasksFile: (projectId) => ipcRenderer.invoke("read-project-tasks-file", { projectId }),
    writeProjectTasksFile: (projectId, data) => ipcRenderer.invoke("write-project-tasks-file", { projectId, data }),
    readProjectTablesFile: (projectId) => ipcRenderer.invoke("read-project-tables-file", { projectId }),
    writeProjectTablesFile: (projectId, data) => ipcRenderer.invoke("write-project-tables-file", { projectId, data }),
    deleteProjectTableTasksFile: (projectId, tableId) => ipcRenderer.invoke("delete-project-table-tasks-file", { projectId, tableId }),
    deleteProjectData: (projectId) => ipcRenderer.invoke("delete-project-data", { projectId }),
    // 写入单个项目的 meta.json
    writeProjectMeta: (projectId, meta) => ipcRenderer.invoke("write-project-meta", { projectId, meta }),
    // 数据迁移相关
    checkMigrationNeeded: () => ipcRenderer.invoke("check-migration-needed"),
    migrateToFolderStorage: () => ipcRenderer.invoke("migrate-to-folder-storage"),
    // 从文件夹恢复项目数据
    recoverProjectsFromFolder: () => ipcRenderer.invoke("recover-projects-from-folder"),
    // 自动更新相关
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("download-update"),
    installUpdate: () => ipcRenderer.invoke("install-update"),
    getAppVersion: () => ipcRenderer.invoke("get-app-version"),
    // 监听更新事件
    onUpdateChecking: (callback) => ipcRenderer.on("update-checking", callback),
    onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (event, info) => callback(info)),
    onUpdateNotAvailable: (callback) => ipcRenderer.on("update-not-available", (event, info) => callback(info)),
    onDownloadProgress: (callback) => ipcRenderer.on("update-download-progress", (event, progress) => callback(progress)),
    onUpdateDownloaded: (callback) => ipcRenderer.on("update-downloaded", (event, info) => callback(info)),
    onUpdateError: (callback) => ipcRenderer.on("update-error", (event, error) => callback(error)),
    // 检查是否在 Electron 环境中
    isElectron: true,
    // 🎬 导出到剪映
    exportToCapCut: (tasks, downloadQueue, jianyingDraftPath, seqStartNumber = 1) => ipcRenderer.invoke("export-to-capcut", { tasks, downloadQueue, jianyingDraftPath, seqStartNumber }),
    // 🎬 监听导出剪映进度事件
    onExportToCapCutProgress: (callback) => {
      const wrappedCallback = (event, progress) => callback(progress);
      ipcRenderer.on("export-to-capcut-progress", wrappedCallback);
      return wrappedCallback;
    },
    // 🎬 移除导出剪映进度监听器
    offExportToCapCutProgress: (callback) => {
      if (callback) {
        ipcRenderer.removeListener("export-to-capcut-progress", callback);
        return;
      }
      ipcRenderer.removeAllListeners("export-to-capcut-progress");
    },
    // 🤖 豆包 AI 助手 - BrowserView 控制
    showDoubaoView: (bounds) => ipcRenderer.invoke("show-doubao-view", bounds),
    hideDoubaoView: () => ipcRenderer.invoke("hide-doubao-view"),
    // 🌐 通用 WebView 控制（猫箱、Vidu、逗哥、即梦等）
    showWebView: ({ siteKey, url, bounds }) => ipcRenderer.invoke("show-web-view", { siteKey, url, bounds }),
    hideWebView: (siteKey) => ipcRenderer.invoke("hide-web-view", siteKey),
    // 设置文件管理
    readSettingsFile: () => ipcRenderer.invoke("read-settings-file"),
    writeSettingsFile: (data) => ipcRenderer.invoke("write-settings-file", { data }),
    getSettingsFilePath: () => ipcRenderer.invoke("get-settings-file-path"),
    migrateLocalData: (payload) => ipcRenderer.invoke("migrate-local-data", payload),
    // 音色库（通过主进程代理请求，避免跨域）
    voiceSelectReferenceAudio: () => ipcRenderer.invoke("voice-library-select-reference-audio"),
    voiceLibraryList: (voiceLibraryPath) => ipcRenderer.invoke("voice-library-list", { voiceLibraryPath }),
    voiceLibraryAddVoice: (voiceLibraryPath, name, sourceAudioPath) => ipcRenderer.invoke("voice-library-add-voice", { voiceLibraryPath, name, sourceAudioPath }),
    voiceLibrarySynthesize: (payload) => ipcRenderer.invoke("voice-library-synthesize", payload),
    voiceLibrarySynthesizeCloud: (payload) => ipcRenderer.invoke("voice-library-synthesize-cloud", payload),
    // 角色库管理
    readCharactersFile: () => ipcRenderer.invoke("read-characters-file"),
    writeCharactersFile: (data) => ipcRenderer.invoke("write-characters-file", { data }),
    saveCharacterImage: (dataUrl, characterId) => ipcRenderer.invoke("save-character-image", { dataUrl, characterId }),
    deleteCharacterImage: (imagePath) => ipcRenderer.invoke("delete-character-image", { imagePath }),
    // 剧本库管理
    readScriptsFile: () => ipcRenderer.invoke("read-scripts-file"),
    writeScriptsFile: (data) => ipcRenderer.invoke("write-scripts-file", { data }),
    // 即梦内嵌服务管理
    jimengServerStart: (port) => ipcRenderer.invoke("jimeng-server-start", { port }),
    jimengServerStop: () => ipcRenderer.invoke("jimeng-server-stop"),
    jimengServerStatus: () => ipcRenderer.invoke("jimeng-server-status"),
    jimengPlaywrightStatus: () => ipcRenderer.invoke("jimeng-playwright-status"),
    onJimengPlaywrightInstallProgress: (callback) => {
      const wrappedCallback = (event, progress) => callback(progress);
      ipcRenderer.on("jimeng-playwright-install-progress", wrappedCallback);
      return wrappedCallback;
    },
    offJimengPlaywrightInstallProgress: (callback) => {
      if (callback) {
        ipcRenderer.removeListener("jimeng-playwright-install-progress", callback);
        return;
      }
      ipcRenderer.removeAllListeners("jimeng-playwright-install-progress");
    },
    // 即梦浏览器登录管理
    jimengLoginOpen: (region) => ipcRenderer.invoke("jimeng-login-open", { region }),
    jimengLoginStatus: () => ipcRenderer.invoke("jimeng-login-status"),
    jimengLogout: () => ipcRenderer.invoke("jimeng-logout"),
    onJimengLoginStatusChange: (callback) => {
      ipcRenderer.on("jimeng-login-status-change", (event, data) => callback(data));
    },
    // 创作工坊数据管理（与推文项目分开）
    readWorkflowProjects: () => ipcRenderer.invoke("read-workflow-projects"),
    writeWorkflowProjects: (projects) => ipcRenderer.invoke("write-workflow-projects", { projects }),
    readWorkflowProjectData: (projectId) => ipcRenderer.invoke("read-workflow-project-data", { projectId }),
    writeWorkflowProjectData: (projectId, data) => ipcRenderer.invoke("write-workflow-project-data", { projectId, data }),
    deleteWorkflowProjectData: (projectId) => ipcRenderer.invoke("delete-workflow-project-data", { projectId }),
    // 创作工坊任务历史
    readWorkflowTasks: (projectId) => ipcRenderer.invoke("read-workflow-tasks", { projectId }),
    writeWorkflowTasks: (projectId, data) => ipcRenderer.invoke("write-workflow-tasks", { projectId, data }),
    // 画布工坊数据管理（与创作工坊分开）
    readCanvasProjects: () => ipcRenderer.invoke("read-canvas-projects"),
    writeCanvasProjects: (projects) => ipcRenderer.invoke("write-canvas-projects", { projects }),
    readCanvasProjectData: (projectId) => ipcRenderer.invoke("read-canvas-project-data", { projectId }),
    writeCanvasProjectData: (projectId, data) => ipcRenderer.invoke("write-canvas-project-data", { projectId, data }),
    deleteCanvasProjectData: (projectId) => ipcRenderer.invoke("delete-canvas-project-data", { projectId })
  });
  console.log("✅ Electron API 已成功注入到 window.electronAPI");
  return preload;
}
requirePreload();