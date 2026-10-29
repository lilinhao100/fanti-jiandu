// 繁体简读 · Tauri 外壳。Rust 端只做前端做不了或不该做的事：
//   - import_files：流式计算 sha256（取前 16 位十六进制当书的 id）并复制到 appDataDir/books
//   - take_pending_open_files：冷启动或单实例转发来的文件路径（文件关联双击）
//   - open_reader：每本书一个窗口（label 为 reader-<id>），已开着就聚焦
// 其余存储（library.json、标注、设置）由前端通过 fs 插件完成，见 app/src/platform/tauri.ts。
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

/// 能打开的扩展名（小写）。与前端 import/prepare.ts 的表保持一致。
const BOOK_EXTS: &[&str] = &["epub", "mobi", "prc", "azw3", "azw", "kf8", "fb2", "txt"];

/// 单实例转发的路径会走这个事件（载荷不重要，前端收到后调用 take_pending_open_files 取走）
const OPEN_FILES_EVENT: &str = "fjd://open-files";

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFile {
    /// 原路径
    path: String,
    /// 原文件名（带扩展名）
    name: String,
    /// 小写扩展名，不带点
    ext: String,
    size: u64,
    /// sha256 前 16 位十六进制；出错时为空
    id: Option<String>,
    /// 复制后的位置：appDataDir/books/<id>.<ext>
    stored_path: Option<String>,
    /// 这份文件之前就已经在 books 目录里（同一本书重复导入）
    existed: bool,
    error: Option<String>,
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_book_path(p: &Path) -> bool {
    BOOK_EXTS.contains(&ext_of(p).as_str())
}

/// 从命令行参数里挑出存在的、扩展名合法的文件路径（跳过第 0 个参数：可执行文件）
fn paths_from_args(args: &[String], cwd: Option<&str>) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let mut p = PathBuf::from(a);
            if p.is_relative() {
                if let Some(c) = cwd {
                    p = Path::new(c).join(p);
                }
            }
            if p.is_file() && is_book_path(&p) {
                Some(p.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 复制一个文件到 books 目录，同时流式计算 sha256。
/// 返回 (id, 落盘路径, 是否早已存在, 字节数)。
fn import_one(books_dir: &Path, src: &Path) -> Result<(String, PathBuf, bool, u64), String> {
    let ext = ext_of(src);
    let mut input = File::open(src).map_err(|e| format!("无法读取文件：{e}"))?;
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = books_dir.join(format!(".import-{}-{seq}.part", std::process::id()));
    let mut out = File::create(&tmp).map_err(|e| format!("无法写入书库目录：{e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let n = input.read(&mut buf).map_err(|e| format!("读取文件失败：{e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| format!("写入失败：{e}"))?;
        size += n as u64;
    }
    drop(out);
    if size == 0 {
        let _ = fs::remove_file(&tmp);
        return Err("文件是空的".into());
    }
    let digest = hasher.finalize();
    let id: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let dest = books_dir.join(format!("{id}.{ext}"));
    if dest.exists() {
        let _ = fs::remove_file(&tmp);
        return Ok((id, dest, true, size));
    }
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("保存失败：{e}")
    })?;
    Ok((id, dest, false, size))
}

#[tauri::command]
async fn import_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<ImportedFile>, String> {
    let books_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("books");
    fs::create_dir_all(&books_dir).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| {
                let src = PathBuf::from(&p);
                let name = src
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let ext = ext_of(&src);
                let fail = |error: String| ImportedFile {
                    path: p.clone(),
                    name: name.clone(),
                    ext: ext.clone(),
                    size: 0,
                    id: None,
                    stored_path: None,
                    existed: false,
                    error: Some(error),
                };
                if !BOOK_EXTS.contains(&ext.as_str()) {
                    return fail(format!("不支持的格式：{name}"));
                }
                match import_one(&books_dir, &src) {
                    Ok((id, dest, existed, size)) => ImportedFile {
                        path: p.clone(),
                        name: name.clone(),
                        ext: ext.clone(),
                        size,
                        id: Some(id),
                        stored_path: Some(dest.to_string_lossy().into_owned()),
                        existed,
                        error: None,
                    },
                    Err(e) => fail(e),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// 系统里的一个字体家族（M2d）。字段名在前端对应 SystemFont（app/src/platform/tauri.ts）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFont {
    /// 英文家族名，写进 CSS 的 font-family
    family: String,
    /// 显示名：优先简体中文的本地化名（“微软雅黑”“宋体”），没有就用英文名
    display_name: String,
    /// 字体里有“简”字（U+7B80）
    has_cjk: bool,
}

/// 用 fontdb 枚举系统字体，按英文家族名去重。Regular、Bold 等合成一项。
fn scan_system_fonts() -> Vec<SystemFont> {
    use std::collections::BTreeMap;
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut by_family: BTreeMap<String, SystemFont> = BTreeMap::new();
    for face in db.faces() {
        let english = face
            .families
            .iter()
            .find(|(_, lang)| *lang == fontdb::Language::English_UnitedStates)
            .or_else(|| face.families.first());
        let Some((family, _)) = english else { continue };
        let zh = face
            .families
            .iter()
            .find(|(_, lang)| {
                *lang == fontdb::Language::Chinese_PRC || *lang == fontdb::Language::Chinese_Singapore
            })
            .map(|(name, _)| name.clone());
        let has_cjk = db
            .with_face_data(face.id, |data, index| {
                ttf_parser::Face::parse(data, index)
                    .ok()
                    .and_then(|f| f.glyph_index('简'))
                    .is_some()
            })
            .unwrap_or(false);
        let key = family.to_lowercase();
        let entry = by_family.entry(key).or_insert_with(|| SystemFont {
            family: family.clone(),
            display_name: zh.clone().unwrap_or_else(|| family.clone()),
            has_cjk,
        });
        entry.has_cjk |= has_cjk;
        if entry.display_name == entry.family {
            if let Some(z) = zh {
                entry.display_name = z;
            }
        }
    }
    by_family.into_values().collect()
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    tauri::async_runtime::spawn_blocking(scan_system_fonts)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_open_files(state: State<'_, PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
async fn open_reader(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("非法的书 id：{id}"));
    }
    let label = format!("reader-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("index.html#/reader/{id}").into()),
    )
    .title("繁体简读")
    .inner_size(1000.0, 780.0)
    .min_inner_size(480.0, 360.0)
    .decorations(false)
    .shadow(true)
    .center()
    .disable_drag_drop_handler()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动（双击文件）把参数转发给已运行的实例
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = paths_from_args(&argv, Some(&cwd));
            if !paths.is_empty() {
                if let Some(state) = app.try_state::<PendingOpen>() {
                    state.0.lock().unwrap().extend(paths);
                }
                let _ = app.emit_to("main", OPEN_FILES_EVENT, ());
            }
            focus_main(app);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(PendingOpen::default())
        .setup(|app| {
            // 冷启动：命令行里的书先放进待办，前端起来后取走
            let args: Vec<String> = std::env::args().collect();
            let paths = paths_from_args(&args, None);
            if !paths.is_empty() {
                app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_files,
            take_pending_open_files,
            open_reader,
            list_system_fonts
        ])
        .run(tauri::generate_context!())
        .expect("启动繁体简读时出错");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_filter_by_extension_and_existence() {
        let dir = std::env::temp_dir().join(format!("fjd-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("a.EPUB");
        let bad = dir.join("b.pdf");
        fs::write(&ok, b"x").unwrap();
        fs::write(&bad, b"x").unwrap();
        let args = vec![
            "app.exe".to_string(),
            ok.to_string_lossy().into_owned(),
            bad.to_string_lossy().into_owned(),
            dir.join("missing.epub").to_string_lossy().into_owned(),
            "--flag".to_string(),
        ];
        assert_eq!(paths_from_args(&args, None), vec![ok.to_string_lossy().into_owned()]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_dedupes_and_hashes() {
        let dir = std::env::temp_dir().join(format!("fjd-test2-{}", std::process::id()));
        let books = dir.join("books");
        fs::create_dir_all(&books).unwrap();
        let src = dir.join("hello.txt");
        fs::write(&src, b"hello").unwrap();
        let (id, dest, existed, size) = import_one(&books, &src).unwrap();
        // sha256("hello") = 2cf24dba5fb0a30e...
        assert_eq!(id, "2cf24dba5fb0a30e");
        assert!(dest.ends_with("2cf24dba5fb0a30e.txt"));
        assert!(!existed);
        assert_eq!(size, 5);
        let (_, _, existed2, _) = import_one(&books, &src).unwrap();
        assert!(existed2);
        fs::remove_dir_all(&dir).ok();
    }
}
