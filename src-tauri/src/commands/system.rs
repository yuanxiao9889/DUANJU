use serde::Serialize;
use std::process::Command;
use std::time::Duration;

#[cfg(target_os = "windows")]
mod windows_native_file_drag {
    use std::ffi::OsString;
    use std::mem::{size_of, ManuallyDrop};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};
    use std::ptr;
    use std::sync::Mutex;
    use std::time::Duration;

    use windows::{
        core::{implement, HRESULT},
        Win32::{
            Foundation::{
                GlobalFree, DATA_S_SAMEFORMATETC, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP,
                DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC, E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED,
                POINT,
            },
            System::{
                Com::{
                    IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
                    DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0,
                    TYMED_HGLOBAL,
                },
                DataExchange::{
                    CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
                },
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND},
                Ole::{
                    DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize,
                    ReleaseStgMedium, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY,
                },
                SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
            },
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
                Shell::{
                    DragQueryFileW, SHCreateStdEnumFmtEtc, CFSTR_FILENAMEW,
                    CFSTR_PERFORMEDDROPEFFECT, CFSTR_PREFERREDDROPEFFECT, DROPFILES, HDROP,
                },
                WindowsAndMessaging::{
                    DispatchMessageW, GetCursorPos, GetSystemMetrics, PeekMessageW,
                    TranslateMessage, MSG, PM_REMOVE, SM_CXDRAG, SM_CYDRAG,
                },
            },
        },
    };
    use windows_core::BOOL;

    fn normalize_drag_file_path(source_path: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(source_path.trim());
        if path.as_os_str().is_empty() {
            return Err("missing source file path".to_string());
        }
        if !path.exists() {
            return Err(format!(
                "drag source file does not exist: {}",
                path.display()
            ));
        }
        if !path.is_file() {
            return Err(format!("drag source is not a file: {}", path.display()));
        }

        Ok(std::fs::canonicalize(&path).unwrap_or(path))
    }

    fn to_wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn build_bytes_hglobal(
        bytes: &[u8],
    ) -> windows::core::Result<windows::Win32::Foundation::HGLOBAL> {
        if bytes.is_empty() {
            return Err(windows::core::Error::from(E_NOTIMPL));
        }

        let hglobal = GlobalAlloc(GHND, bytes.len())?;
        let data_ptr = GlobalLock(hglobal) as *mut u8;
        if data_ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err(windows::core::Error::from_win32());
        }

        ptr::copy_nonoverlapping(bytes.as_ptr(), data_ptr, bytes.len());
        let _ = GlobalUnlock(hglobal);
        Ok(hglobal)
    }

    unsafe fn build_dropfiles_hglobal(
        paths: &[PathBuf],
    ) -> windows::core::Result<windows::Win32::Foundation::HGLOBAL> {
        if paths.is_empty() {
            return Err(windows::core::Error::from(E_NOTIMPL));
        }

        let wide_paths: Vec<Vec<u16>> = paths.iter().map(|path| to_wide_path(path)).collect();
        let total_utf16_units = wide_paths.iter().map(|path| path.len()).sum::<usize>() + 1;
        let total_bytes = size_of::<DROPFILES>() + total_utf16_units * size_of::<u16>();

        let hglobal = GlobalAlloc(GHND, total_bytes)?;
        let data_ptr = GlobalLock(hglobal) as *mut u8;
        if data_ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err(windows::core::Error::from_win32());
        }

        let write_result = (|| -> windows::core::Result<()> {
            let dropfiles = DROPFILES {
                pFiles: size_of::<DROPFILES>() as u32,
                pt: POINT { x: 0, y: 0 },
                fNC: BOOL(0),
                fWide: BOOL(1),
            };

            (data_ptr as *mut DROPFILES).write(dropfiles);
            let mut current = data_ptr.add(size_of::<DROPFILES>()) as *mut u16;
            for wide_path in &wide_paths {
                ptr::copy_nonoverlapping(wide_path.as_ptr(), current, wide_path.len());
                current = current.add(wide_path.len());
            }
            current.write(0);
            Ok(())
        })();

        let _ = GlobalUnlock(hglobal);

        if let Err(error) = write_result {
            let _ = GlobalFree(Some(hglobal));
            return Err(error);
        }

        Ok(hglobal)
    }

    unsafe fn build_file_name_w_hglobal(
        path: &Path,
    ) -> windows::core::Result<windows::Win32::Foundation::HGLOBAL> {
        let mut wide_path = to_wide_path(path);
        wide_path.push(0);
        let bytes = std::slice::from_raw_parts(
            wide_path.as_ptr() as *const u8,
            wide_path.len() * size_of::<u16>(),
        );
        build_bytes_hglobal(bytes)
    }

    unsafe fn build_drop_effect_hglobal(
        effect: DROPEFFECT,
    ) -> windows::core::Result<windows::Win32::Foundation::HGLOBAL> {
        build_bytes_hglobal(&effect.0.to_le_bytes())
    }

    unsafe fn read_drop_effect_hglobal(
        hglobal: windows::Win32::Foundation::HGLOBAL,
    ) -> windows::core::Result<DROPEFFECT> {
        let data_ptr = GlobalLock(hglobal) as *const u32;
        if data_ptr.is_null() {
            return Err(windows::core::Error::from_win32());
        }

        let effect = DROPEFFECT(data_ptr.read());
        let _ = GlobalUnlock(hglobal);
        Ok(effect)
    }

    #[derive(Clone, Copy)]
    enum FileDropFormatKind {
        Hdrop,
        FileNameW,
        PreferredDropEffect,
    }

    #[derive(Clone, Copy)]
    struct FileDropFormatDescriptor {
        kind: FileDropFormatKind,
        format_etc: FORMATETC,
    }

    #[implement(IDataObject)]
    struct FileDropDataObject {
        paths: Vec<PathBuf>,
        formats: Vec<FileDropFormatDescriptor>,
        preferred_drop_effect_format: u16,
        performed_drop_effect_format: u16,
        preferred_drop_effect: Mutex<DROPEFFECT>,
        performed_drop_effect: Mutex<Option<DROPEFFECT>>,
    }

    impl FileDropDataObject {
        fn build_format_etc(cf_format: u16) -> FORMATETC {
            FORMATETC {
                cfFormat: cf_format,
                ptd: ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }
        }

        fn new(paths: Vec<PathBuf>) -> Result<Self, String> {
            let file_name_w_format = unsafe { RegisterClipboardFormatW(CFSTR_FILENAMEW) };
            if file_name_w_format == 0 {
                return Err("RegisterClipboardFormatW(FileNameW) failed".to_string());
            }

            let preferred_drop_effect_format =
                unsafe { RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT) };
            if preferred_drop_effect_format == 0 {
                return Err("RegisterClipboardFormatW(Preferred DropEffect) failed".to_string());
            }

            let performed_drop_effect_format =
                unsafe { RegisterClipboardFormatW(CFSTR_PERFORMEDDROPEFFECT) };
            if performed_drop_effect_format == 0 {
                return Err("RegisterClipboardFormatW(Performed DropEffect) failed".to_string());
            }

            let mut formats = vec![FileDropFormatDescriptor {
                kind: FileDropFormatKind::Hdrop,
                format_etc: Self::build_format_etc(CF_HDROP.0),
            }];
            if paths.len() == 1 {
                formats.push(FileDropFormatDescriptor {
                    kind: FileDropFormatKind::FileNameW,
                    format_etc: Self::build_format_etc(file_name_w_format as u16),
                });
            }
            formats.push(FileDropFormatDescriptor {
                kind: FileDropFormatKind::PreferredDropEffect,
                format_etc: Self::build_format_etc(preferred_drop_effect_format as u16),
            });

            Ok(Self {
                paths,
                formats,
                preferred_drop_effect_format: preferred_drop_effect_format as u16,
                performed_drop_effect_format: performed_drop_effect_format as u16,
                preferred_drop_effect: Mutex::new(DROPEFFECT_COPY),
                performed_drop_effect: Mutex::new(None),
            })
        }

        fn find_format(&self, format: &FORMATETC) -> Option<FileDropFormatDescriptor> {
            self.formats.iter().copied().find(|descriptor| {
                descriptor.format_etc.cfFormat == format.cfFormat
                    && format.dwAspect == DVASPECT_CONTENT.0
                    && (format.tymed & (TYMED_HGLOBAL.0 as u32)) != 0
            })
        }

        fn build_medium(&self, kind: FileDropFormatKind) -> windows::core::Result<STGMEDIUM> {
            let hglobal = unsafe {
                match kind {
                    FileDropFormatKind::Hdrop => build_dropfiles_hglobal(&self.paths),
                    FileDropFormatKind::FileNameW => self
                        .paths
                        .first()
                        .ok_or_else(|| windows::core::Error::from(E_NOTIMPL))
                        .and_then(|path| build_file_name_w_hglobal(path)),
                    FileDropFormatKind::PreferredDropEffect => {
                        build_drop_effect_hglobal(*self.preferred_drop_effect.lock().unwrap())
                    }
                }
            }?;

            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: hglobal },
                pUnkForRelease: ManuallyDrop::new(None),
            })
        }

        fn read_drop_effect_from_medium(
            &self,
            pmedium: *const STGMEDIUM,
        ) -> windows::core::Result<DROPEFFECT> {
            let medium = unsafe { pmedium.as_ref() }
                .ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?;
            if medium.tymed != TYMED_HGLOBAL.0 as u32 {
                return Err(windows::core::Error::from(DV_E_FORMATETC));
            }

            unsafe { read_drop_effect_hglobal(medium.u.hGlobal) }
        }
    }

    #[implement(IDropSource)]
    struct FileDropSource;

    #[allow(non_snake_case)]
    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(
            &self,
            fescapepressed: BOOL,
            grfkeystate: MODIFIERKEYS_FLAGS,
        ) -> HRESULT {
            if fescapepressed.as_bool() {
                DRAGDROP_S_CANCEL
            } else if (grfkeystate.0 & MK_LBUTTON.0) == 0 {
                DRAGDROP_S_DROP
            } else {
                HRESULT(0)
            }
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    #[allow(non_snake_case)]
    impl IDataObject_Impl for FileDropDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
            let format = unsafe { pformatetcin.as_ref() }
                .ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?;
            let descriptor = self
                .find_format(format)
                .ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?;
            self.build_medium(descriptor.kind)
        }

        fn GetDataHere(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *mut STGMEDIUM,
        ) -> windows::core::Result<()> {
            Err(windows::core::Error::from(E_NOTIMPL))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> windows::core::HRESULT {
            match unsafe { pformatetc.as_ref() } {
                Some(format) if self.find_format(format).is_some() => windows::core::HRESULT(0),
                _ => DV_E_FORMATETC,
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            _pformatectin: *const FORMATETC,
            pformatetcout: *mut FORMATETC,
        ) -> windows::core::HRESULT {
            if let Some(format_out) = unsafe { pformatetcout.as_mut() } {
                format_out.ptd = ptr::null_mut();
            }
            DATA_S_SAMEFORMATETC
        }

        fn SetData(
            &self,
            pformatetc: *const FORMATETC,
            pmedium: *const STGMEDIUM,
            frelease: BOOL,
        ) -> windows::core::Result<()> {
            let format = unsafe { pformatetc.as_ref() }
                .ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?;
            let effect = self.read_drop_effect_from_medium(pmedium)?;

            if format.cfFormat == self.preferred_drop_effect_format {
                *self.preferred_drop_effect.lock().unwrap() = effect;
            } else if format.cfFormat == self.performed_drop_effect_format {
                *self.performed_drop_effect.lock().unwrap() = Some(effect);
            } else {
                return Err(windows::core::Error::from(E_NOTIMPL));
            }

            if frelease.as_bool() {
                let mut medium = unsafe { pmedium.as_ref() }
                    .ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?
                    .clone();
                unsafe {
                    ReleaseStgMedium(&mut medium);
                }
            }

            Ok(())
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> windows::core::Result<IEnumFORMATETC> {
            if dwdirection != DATADIR_GET.0 as u32 {
                return Err(windows::core::Error::from(E_NOTIMPL));
            }

            let formats = self
                .formats
                .iter()
                .map(|descriptor| descriptor.format_etc)
                .collect::<Vec<_>>();
            unsafe { SHCreateStdEnumFmtEtc(&formats) }
        }

        fn DAdvise(
            &self,
            _pformatetc: *const FORMATETC,
            _advf: u32,
            _padvsink: windows::core::Ref<'_, IAdviseSink>,
        ) -> windows::core::Result<u32> {
            Err(windows::core::Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> windows::core::Result<()> {
            Err(windows::core::Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
            Err(windows::core::Error::from(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    fn is_left_button_pressed() -> bool {
        unsafe { (GetAsyncKeyState(VK_LBUTTON.0.into()) as u16 & 0x8000) != 0 }
    }

    fn current_cursor_pos() -> Result<POINT, String> {
        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point).map_err(|error| format!("GetCursorPos failed: {error}"))?;
        }
        Ok(point)
    }

    fn pump_waiting_messages() {
        unsafe {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    fn wait_for_drag_threshold() -> Result<bool, String> {
        let start = current_cursor_pos()?;
        let threshold_x = unsafe { GetSystemMetrics(SM_CXDRAG) }.max(4);
        let threshold_y = unsafe { GetSystemMetrics(SM_CYDRAG) }.max(4);

        while is_left_button_pressed() {
            pump_waiting_messages();
            let current = current_cursor_pos()?;
            let dx = (current.x - start.x).abs();
            let dy = (current.y - start.y).abs();
            if dx >= threshold_x || dy >= threshold_y {
                return Ok(true);
            }

            std::thread::sleep(Duration::from_millis(8));
        }

        Ok(false)
    }

    fn run_native_file_drag(path: PathBuf) -> Result<bool, String> {
        if !wait_for_drag_threshold()? {
            return Ok(false);
        }

        unsafe {
            OleInitialize(None).map_err(|error| format!("OleInitialize failed: {error}"))?;
        }

        let result = (|| {
            let data_object: IDataObject = FileDropDataObject::new(vec![path])?.into();
            let drop_source: IDropSource = FileDropSource.into();
            let mut effect = DROPEFFECT(0);
            let drag_result =
                unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut effect) };

            if drag_result == DRAGDROP_S_CANCEL {
                Ok(false)
            } else if drag_result == DRAGDROP_S_DROP {
                Ok(true)
            } else {
                drag_result
                    .ok()
                    .map_err(|error| format!("DoDragDrop failed: {error}"))?;
                Ok(effect.0 != 0)
            }
        })();

        unsafe {
            OleUninitialize();
        }

        result
    }

    pub fn start_windows_system_file_drag(source_path: String) -> Result<bool, String> {
        let normalized_path = normalize_drag_file_path(&source_path)?;
        run_native_file_drag(normalized_path)
    }

    struct ClipboardGuard;

    impl ClipboardGuard {
        fn open() -> Result<Self, String> {
            unsafe {
                OpenClipboard(None).map_err(|error| format!("OpenClipboard failed: {error}"))?;
            }

            Ok(Self)
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn normalize_clipboard_path(path: &Path) -> Option<String> {
        if !path.exists() || !path.is_file() {
            return None;
        }

        let normalized = std::fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string();
        if normalized.trim().is_empty() {
            None
        } else {
            Some(normalized)
        }
    }

    pub fn read_windows_clipboard_file_paths() -> Result<Vec<String>, String> {
        let _clipboard_guard = ClipboardGuard::open()?;

        unsafe {
            let handle = match GetClipboardData(CF_HDROP.0 as u32) {
                Ok(handle) => handle,
                Err(_) => return Ok(Vec::new()),
            };
            let hdrop = HDROP(handle.0);
            let file_count = DragQueryFileW(hdrop, u32::MAX, None);
            if file_count == 0 {
                return Ok(Vec::new());
            }

            let mut paths = Vec::with_capacity(file_count as usize);
            for index in 0..file_count {
                let buffer_len = DragQueryFileW(hdrop, index, None).saturating_add(1);
                if buffer_len <= 1 {
                    continue;
                }

                let mut buffer = vec![0u16; buffer_len as usize];
                let written = DragQueryFileW(hdrop, index, Some(buffer.as_mut_slice()));
                if written == 0 {
                    continue;
                }

                let os_path = OsString::from_wide(&buffer[..written as usize]);
                let path = PathBuf::from(os_path);
                if let Some(normalized) = normalize_clipboard_path(&path) {
                    paths.push(normalized);
                }
            }

            Ok(paths)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub os_build: String,
}

fn run_command(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(target_os = "windows")]
fn resolve_windows_info() -> RuntimeSystemInfo {
    let ver_text =
        run_command("cmd", &["/C", "ver"]).unwrap_or_else(|| "Microsoft Windows".to_string());
    let version_token = ver_text
        .split_once('[')
        .and_then(|(_, right)| right.split_once(']'))
        .map(|(inside, _)| inside.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let normalized_version = version_token
        .strip_prefix("Version")
        .map(|raw| raw.trim().to_string())
        .unwrap_or(version_token);
    let build = normalized_version
        .split('.')
        .nth(2)
        .unwrap_or("unknown")
        .to_string();

    let product_name = run_command(
        "reg",
        &[
            "query",
            r#"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion"#,
            "/v",
            "ProductName",
        ],
    )
    .and_then(|raw| {
        raw.lines()
            .find(|line| line.contains("ProductName"))
            .map(|line| {
                line.split_whitespace()
                    .last()
                    .unwrap_or("Windows")
                    .to_string()
            })
    })
    .unwrap_or_else(|| "Windows".to_string());

    RuntimeSystemInfo {
        os_name: product_name,
        os_version: normalized_version,
        os_build: build,
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_info() -> RuntimeSystemInfo {
    let version =
        run_command("sw_vers", &["-productVersion"]).unwrap_or_else(|| "unknown".to_string());
    let build = run_command("sw_vers", &["-buildVersion"]).unwrap_or_else(|| "unknown".to_string());

    RuntimeSystemInfo {
        os_name: "macOS".to_string(),
        os_version: version,
        os_build: build,
    }
}

#[cfg(target_os = "linux")]
fn resolve_linux_info() -> RuntimeSystemInfo {
    let mut os_name = "Linux".to_string();
    let mut os_version = "unknown".to_string();

    if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
        for line in content.lines() {
            if let Some(value) = line.strip_prefix("NAME=") {
                os_name = value.trim_matches('"').to_string();
            } else if let Some(value) = line.strip_prefix("VERSION_ID=") {
                os_version = value.trim_matches('"').to_string();
            }
        }
    }

    let build = run_command("uname", &["-r"]).unwrap_or_else(|| "unknown".to_string());
    RuntimeSystemInfo {
        os_name,
        os_version,
        os_build: build,
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn resolve_generic_info() -> RuntimeSystemInfo {
    RuntimeSystemInfo {
        os_name: std::env::consts::OS.to_string(),
        os_version: "unknown".to_string(),
        os_build: "unknown".to_string(),
    }
}

#[tauri::command]
pub fn get_runtime_system_info() -> RuntimeSystemInfo {
    #[cfg(target_os = "windows")]
    {
        return resolve_windows_info();
    }

    #[cfg(target_os = "macos")]
    {
        return resolve_macos_info();
    }

    #[cfg(target_os = "linux")]
    {
        return resolve_linux_info();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        resolve_generic_info()
    }
}

#[tauri::command]
pub fn read_system_clipboard_file_paths(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = windows_native_file_drag::read_windows_clipboard_file_paths();
            let _ = tx.send(result);
        })
        .map_err(|error| format!("failed to schedule clipboard read on main thread: {error}"))?;

        return rx
            .recv()
            .map_err(|_| "clipboard read result channel closed".to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_app_exit(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;
        app.exit(0);
    });

    Ok(())
}

#[tauri::command]
pub fn start_system_file_drag(app: tauri::AppHandle, source_path: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = windows_native_file_drag::start_windows_system_file_drag(source_path);
            let _ = tx.send(result);
        })
        .map_err(|error| format!("failed to schedule native drag on main thread: {error}"))?;

        return rx
            .recv()
            .map_err(|_| "native drag result channel closed".to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = source_path;
        Ok(false)
    }
}
