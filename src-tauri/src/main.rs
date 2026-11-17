#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// ویرایشگر عکس — بک‌اند Rust (Tauri v2)
// دستورهای Rust برای کارهای سنگین پیکسلی: تنظیم نور/رنگ، نویزگیری،
/// تغییر اندازه و تبدیل فرمت. ابزارهای قلمی در فرانت‌اند (Canvas) انجام می‌شوند.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::{DynamicImage, GenericImageView, ImageFormat, Pixel};
use serde::Serialize;
use std::io::Cursor;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// ---------- ابزارهای کمکی ----------

fn decode_data_url(data_url: &str) -> Result<(Vec<u8>, String), String> {
    let parts: Vec<&str> = data_url.splitn(2, ",").collect();
    if parts.len() != 2 {
        return Err("data URL نامعتبر است".to_string());
    }
    let mime = parts[0]
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("image/png")
        .to_string();
    let bytes = B64
        .decode(parts[1].trim())
        .map_err(|e| format!("خطا در decode base64: {e}"))?;
    Ok((bytes, mime))
}

fn encode_png_data_url(img: &DynamicImage) -> Result<String, String> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("خطا در encode PNG: {e}"))?;
    Ok(format!("data:image/png;base64,{}", B64.encode(&buf)))
}

fn clamp(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

/// اعمال روشنایی/کنتراست/اشباع/گرما روی هر پیکسل (در محل).
fn pixel_adjust(img: &mut DynamicImage, brightness: f32, contrast: f32, saturation: f32, warmth: f32, hue_deg: f32) {
    let mut rgba = img.to_rgba8();
    let c = (contrast.clamp(-100.0, 100.0)) * 2.55;
    let factor = if (259.0 - c).abs() < 0.01 {
        1.0
    } else {
        (259.0 * (c + 255.0)) / (255.0 * (259.0 - c))
    };
    let sat = 1.0 + saturation.clamp(-100.0, 100.0) / 100.0;
    let add = brightness.clamp(-100.0, 100.0) * 1.27;
    let warm = warmth.clamp(-100.0, 100.0) * 0.6;
    let hue_rad = hue_deg.clamp(-180.0, 180.0).to_radians();
    let (cos_a, sin_a) = (hue_rad.cos(), hue_rad.sin());
    for px in rgba.pixels_mut() {
        let ch = px.channels_mut();
        let (mut r, mut g, mut b) = (ch[0] as f32, ch[1] as f32, ch[2] as f32);
        // روشنایی
        r += add;
        g += add;
        b += add;
        // کنتراست
        r = factor * (r - 128.0) + 128.0;
        g = factor * (g - 128.0) + 128.0;
        b = factor * (b - 128.0) + 128.0;
        // اشباع: ترکیب با خاکستری
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * sat;
        g = gray + (g - gray) * sat;
        b = gray + (b - gray) * sat;
        // گرما: قرمز بیشتر / آبی کمتر
        r += warm;
        b -= warm;
        // چرخش رنگ (Hue) با ماتریس استاندارد
        if hue_deg != 0.0 {
            let nr = (0.299 + 0.701 * cos_a + 0.168 * sin_a) * r
                + (0.587 - 0.587 * cos_a + 0.168 * sin_a) * g
                + (0.114 - 0.114 * cos_a - 0.497 * sin_a) * b;
            let ng = (0.299 - 0.299 * cos_a - 0.328 * sin_a) * r
                + (0.587 + 0.413 * cos_a + 0.064 * sin_a) * g
                + (0.114 - 0.114 * cos_a + 0.497 * sin_a) * b;
            let nb = (0.299 - 0.299 * cos_a + 0.559 * sin_a) * r
                + (0.587 - 0.587 * cos_a - 0.330 * sin_a) * g
                + (0.114 + 0.886 * cos_a - 0.168 * sin_a) * b;
            r = nr;
            g = ng;
            b = nb;
        }
        ch[0] = clamp(r);
        ch[1] = clamp(g);
        ch[2] = clamp(b);
    }
    *img = DynamicImage::ImageRgba8(rgba);
}

// ---------- دستورهای Tauri ----------

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    engine: String,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "ویرایشگر عکس".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        engine: "Rust + Tauri v2".to_string(),
    }
}

/// پنجره انتخاب عکس (Rust + پلاگین dialog)
#[tauri::command]
fn open_image_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("تصاویر", &["png", "jpg", "jpeg", "bmp", "gif", "webp"])
        .add_filter("همه فایل‌ها", &["*"])
        .blocking_pick_file();
    Ok(file.and_then(|p| p.as_path().map(|x| x.to_string_lossy().to_string())))
}

/// پنجره ذخیره عکس
#[tauri::command]
fn save_image_dialog(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("BMP", &["bmp"])
        .add_filter("GIF", &["gif"])
        .blocking_save_file();
    Ok(file.and_then(|p| p.as_path().map(|x| x.to_string_lossy().to_string())))
}

/// خواندن فایل عکس از دیسک و برگرداندن data URL
#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("خواندن فایل ناموفق بود: {e}"))?;
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", B64.encode(&bytes)))
}

/// ذخیره data URL عکس در مسیر داده‌شده
#[tauri::command]
fn save_image_data_url(path: String, data_url: String) -> Result<(), String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    std::fs::write(&path, bytes).map_err(|e| format!("ذخیره فایل ناموفق بود: {e}"))?;
    Ok(())
}

/// تنظیم نور/رنگ/تاری/وضوح با Rust — ورودی و خروجی data URL (PNG)
#[tauri::command]
fn adjust_image(
    data_url: String,
    brightness: f32,
    contrast: f32,
    saturation: f32,
    warmth: f32,
    hue: f32,
    blur: f32,
    sharpen: f32,
) -> Result<String, String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let mut img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    pixel_adjust(&mut img, brightness, contrast, saturation, warmth, hue);
    if blur > 0.2 {
        let blurred = image::imageops::blur(&img, blur / 4.0);
        img = DynamicImage::ImageRgba8(blurred);
    }
    if sharpen > 1.0 {
        let sharp = image::imageops::unsharpen(&img, 1.2, 3);
        img = DynamicImage::ImageRgba8(sharp);
    }
    encode_png_data_url(&img)
}

/// نویزگیری (Denoise) با Rust — تاری ملایم گاوسی + حفظ جزئیات با unsharpen خفیف
#[tauri::command]
fn denoise_image(data_url: String, strength: f32) -> Result<String, String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    let sigma = (strength.clamp(0.0, 100.0) / 100.0) * 1.6 + 0.3;
    let blurred = image::imageops::blur(&img, sigma);
    let mut out = DynamicImage::ImageRgba8(blurred);
    // بازگرداندن کمی وضوح تا عکس «صابونی» نشود
    let sharp = image::imageops::unsharpen(&out, 0.8, 5);
    out = DynamicImage::ImageRgba8(sharp);
    encode_png_data_url(&out)
}

/// تغییر اندازه (Scale / Batch Resize) با Rust — خروجی PNG
#[tauri::command]
fn resize_image_data(data_url: String, width: u32, height: u32) -> Result<String, String> {
    if width == 0 || height == 0 || width > 12000 || height > 12000 {
        return Err("ابعاد نامعتبر است (۱ تا ۱۲۰۰۰)".to_string());
    }
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    let resized = image::imageops::resize(&img, width, height, image::imageops::FilterType::Lanczos3);
    encode_png_data_url(&DynamicImage::ImageRgba8(resized))
}

/// تبدیل فرمت عکس (png / jpeg / bmp / gif) با Rust — برای ذخیره واقعی BMP و GIF
#[tauri::command]
fn convert_image_format(data_url: String, format: String) -> Result<String, String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    let fmt = match format.to_lowercase().as_str() {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "bmp" => ImageFormat::Bmp,
        "gif" => ImageFormat::Gif,
        _ => ImageFormat::Png,
    };
    let mime = match fmt {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Bmp => "image/bmp",
        ImageFormat::Gif => "image/gif",
        _ => "image/png",
    };
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), fmt)
        .map_err(|e| format!("تبدیل فرمت ناموفق بود: {e}"))?;
    Ok(format!("data:{mime};base64,{}", B64.encode(&buf)))
}

/// تبدیل به GIF تک‌فریم (ذخیره GIF استاتیک)
#[tauri::command]
fn convert_to_gif(data_url: String) -> Result<String, String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Gif)
        .map_err(|e| format!("تبدیل به GIF ناموفق بود: {e}"))?;
    Ok(format!("data:image/gif;base64,{}", B64.encode(&buf)))
}

/// انتخاب پوشه مقصد برای تغییر اندازه گروهی
#[tauri::command]
fn pick_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.and_then(|p| p.as_path().map(|x| x.to_string_lossy().to_string())))
}

/// ابعاد عکس (برای نمایش در نوار وضعیت)
#[tauri::command]
fn image_dimensions(data_url: String) -> Result<(u32, u32), String> {
    let (bytes, _mime) = decode_data_url(&data_url)?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("بارگذاری عکس ناموفق بود: {e}"))?;
    Ok(img.dimensions())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            open_image_dialog,
            save_image_dialog,
            read_image_as_data_url,
            save_image_data_url,
            adjust_image,
            denoise_image,
            resize_image_data,
            convert_to_gif,
            convert_image_format,
            pick_folder_dialog,
            image_dimensions
        ])
        .run(tauri::generate_context!())
        .expect("خطا در اجرای برنامه ویرایشگر عکس");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn make_test_png() -> String {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(8, 8, |x, y| Rgb([(x * 30) as u8, (y * 30) as u8, 100]));
        let dyn_img = DynamicImage::ImageRgb8(img);
        let mut buf = Vec::new();
        dyn_img
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        format!("data:image/png;base64,{}", B64.encode(&buf))
    }

    fn decode_out(data_url: &str) -> DynamicImage {
        let (bytes, _) = decode_data_url(data_url).unwrap();
        image::load_from_memory(&bytes).unwrap()
    }

    #[test]
    fn adjust_brightens_and_keeps_size() {
        let src = make_test_png();
        let out = adjust_image(src.clone(), 50.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).unwrap();
        let img = decode_out(&out);
        assert_eq!(img.dimensions(), (8, 8));
        assert_ne!(out, src, "روشنایی باید پیکسل‌ها را عوض کند");
    }

    #[test]
    fn adjust_hue_and_blur_do_not_crash() {
        let src = make_test_png();
        let out = adjust_image(src, 0.0, 20.0, 30.0, -20.0, 90.0, 2.0, 50.0).unwrap();
        assert_eq!(decode_out(&out).dimensions(), (8, 8));
    }

    #[test]
    fn denoise_and_resize_work() {
        let src = make_test_png();
        let d = denoise_image(src.clone(), 60.0).unwrap();
        assert_eq!(decode_out(&d).dimensions(), (8, 8));
        let r = resize_image_data(src, 4, 4).unwrap();
        assert_eq!(decode_out(&r).dimensions(), (4, 4));
        assert!(resize_image_data(make_test_png(), 0, 4).is_err());
    }

    #[test]
    fn convert_gif_and_bmp_work() {
        let src = make_test_png();
        let gif = convert_to_gif(src.clone()).unwrap();
        assert!(gif.starts_with("data:image/gif;base64,"));
        let bmp = convert_image_format(src, "bmp".to_string()).unwrap();
        assert!(bmp.starts_with("data:image/bmp;base64,"));
        let (bytes, _) = decode_data_url(&bmp).unwrap();
        assert_eq!(&bytes[0..2], b"BM", "BMP واقعی باید با BM شروع شود");
    }

    #[test]
    fn invalid_input_is_rejected() {
        assert!(adjust_image("not-a-data-url".to_string(), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).is_err());
        assert!(image_dimensions("data:image/png;base64,AAAA".to_string()).is_err());
    }
}
