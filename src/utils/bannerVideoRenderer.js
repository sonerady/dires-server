// Banner Studio — animasyonlu HTML banner'ı loop MP4 videoya çevirir.
// Deterministik render: tüm CSS animasyonları Web Animations API ile duraklatılır,
// her karede currentTime elle ilerletilir, kareler ffmpeg ile MP4'e dikilir.
// Hız: zaman çizelgesi deterministik olduğundan kareler N paralel sekmeye bölünür.
const puppeteer = require("puppeteer-core");
const ffmpegPath = require("ffmpeg-static");
const { execFile, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FPS = 60;
const DEFAULT_LOOP_SECONDS = 5;
const MIN_LOOP_SECONDS = 2;
const MAX_LOOP_SECONDS = 10;
const TARGET_LONG_EDGE = 1920; // çıktı videonun uzun kenarı (px) — 9:16'da 1080×1920 tam HD
const WORKERS = Math.max(
  1,
  parseInt(process.env.BANNER_VIDEO_WORKERS, 10) || 3
);

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Railway/Nix: PATH'teki chromium; macOS dev: yüklü Chrome
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome-stable",
    "google-chrome",
  ];
  for (const bin of candidates) {
    try {
      const found = execSync(`command -v ${bin}`, { stdio: ["pipe", "pipe", "ignore"] })
        .toString()
        .trim();
      if (found) return found;
    } catch (e) {
      /* sıradakine bak */
    }
  }
  const macChrome =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(macChrome)) return macChrome;
  throw new Error(
    "Chromium not found — set PUPPETEER_EXECUTABLE_PATH or add chromium to the image"
  );
}

// arn = genişlik/yükseklik; çift sayıya yuvarla (libx264 şartı)
function videoDimensions(arn) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (arn >= 1) {
    return { width: even(TARGET_LONG_EDGE), height: even(TARGET_LONG_EDGE / arn) };
  }
  return { width: even(TARGET_LONG_EDGE * arn), height: even(TARGET_LONG_EDGE) };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 64 }, (err, _out, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg failed: ${stderr?.slice(-800) || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

// Bir sekmeyi banner'la hazırla: içerik + animasyonlar duraklatılmış halde
async function preparePage(browser, html, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => {
      try {
        a.pause();
      } catch (e) {}
    });
  });
  return page;
}

/**
 * @param {string} html  Banner HTML dokümanı
 * @param {number} arn   Genişlik/yükseklik oranı
 * @returns {Promise<{ filePath: string, cleanup: () => void, durationSeconds: number }>}
 */
async function renderBannerVideo(html, arn) {
  const { width, height } = videoDimensions(arn || 4 / 5);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "banner-video-"));
  const framesDir = path.join(workDir, "frames");
  fs.mkdirSync(framesDir);
  const outPath = path.join(workDir, "banner.mp4");
  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {
      /* tmp — kritik değil */
    }
  };

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
      ],
    });

    // İlk sekme: döngü süresini oku
    const firstPage = await preparePage(browser, html, width, height);
    const declared = await firstPage.evaluate(() => {
      const meta = document.querySelector('meta[name="loop-duration"]');
      const v = meta ? parseFloat(meta.content) : NaN;
      return Number.isFinite(v) ? v : null;
    });
    const durationSeconds = Math.min(
      MAX_LOOP_SECONDS,
      Math.max(MIN_LOOP_SECONDS, declared || DEFAULT_LOOP_SECONDS)
    );
    const totalFrames = Math.round(durationSeconds * FPS);

    // Kalan worker sekmeleri
    const workerCount = Math.min(WORKERS, totalFrames);
    const pages = [firstPage];
    for (let i = 1; i < workerCount; i++) {
      pages.push(await preparePage(browser, html, width, height));
    }

    // Zaman çizelgesini segmentlere böl: worker k → [k*chunk, (k+1)*chunk)
    const chunk = Math.ceil(totalFrames / workerCount);
    await Promise.all(
      pages.map(async (page, k) => {
        const start = k * chunk;
        const end = Math.min(start + chunk, totalFrames);
        for (let i = start; i < end; i++) {
          const tMs = (i / FPS) * 1000;
          await page.evaluate((t) => {
            document.getAnimations().forEach((a) => {
              try {
                a.currentTime = t;
              } catch (e) {}
            });
          }, tMs);
          await page.screenshot({
            path: path.join(framesDir, `frame${String(i).padStart(5, "0")}.png`),
            type: "png",
            optimizeForSpeed: true,
          });
        }
      })
    );

    await browser.close();
    browser = null;

    await runFfmpeg([
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      path.join(framesDir, "frame%05d.png"),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "16",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);

    return { filePath: outPath, cleanup, durationSeconds };
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    cleanup();
    throw error;
  }
}

/**
 * Banner'ın TEK karesini JPEG buffer olarak döndürür — Results kartlarındaki
 * önizleme görseli. Video hattıyla aynı sayfa hazırlığını kullanır
 * (animasyonlar duraklatılmış: ilk kare temiz yakalanır).
 * @param {string} html  Banner HTML dokümanı
 * @param {number} arn   Genişlik/yükseklik oranı
 * @returns {Promise<Buffer>}
 */
async function renderBannerScreenshot(html, arn) {
  const { width, height } = videoDimensions(arn || 4 / 5);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
      ],
    });
    const page = await preparePage(browser, html, width, height);
    return await page.screenshot({ type: "jpeg", quality: 82 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { renderBannerVideo, renderBannerScreenshot };
