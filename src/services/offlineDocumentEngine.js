const DEFAULT_MAX_PAGE_PIXELS = 10_000_000;

// Jumlah karakter minimum agar halaman dianggap memiliki teks asli yang bermakna.
// Nilai kecil ini sengaja konservatif — halaman dengan hanya beberapa karakter noise
// tetap tidak dianggap "punya teks".
const MIN_MEANINGFUL_TEXT_CHARS = 10;

export const OFFLINE_DOCUMENT_ENGINE_VERSIONS = Object.freeze({
  pdfjs: '6.4.299',
  tesseract: '7.0.0',
  tesseractCore: '7.0.0',
  englishModel: '1.0.0',
  indonesianModel: '1.0.0',
});

export class OfflineDocumentEngineError extends Error {
  constructor(code) {
    super('Dokumen tidak dapat diproses secara lokal.');
    this.name = 'OfflineDocumentEngineError';
    this.code = code;
  }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new OfflineDocumentEngineError('request_cancelled');
}

function reportDiagnostic(options, stage) {
  if (typeof options.onDiagnostic === 'function') options.onDiagnostic(stage);
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function safeAssetUrl(relativePath, rootUrl) {
  const resolved = new URL(relativePath, rootUrl);
  if (!['file:', 'http:', 'https:'].includes(resolved.protocol)) {
    throw new OfflineDocumentEngineError('invalid_asset_location');
  }
  if (resolved.protocol !== rootUrl.protocol || resolved.origin !== rootUrl.origin) {
    throw new OfflineDocumentEngineError('invalid_asset_location');
  }
  return resolved.href;
}

export function resolveOfflineDocumentAssetPaths(baseUrl = globalThis.document?.baseURI) {
  if (typeof baseUrl !== 'string' || baseUrl.length < 1) {
    throw new OfflineDocumentEngineError('invalid_asset_location');
  }
  const rootUrl = new URL('./offline-scanner/', baseUrl);
  if (!['file:', 'http:', 'https:'].includes(rootUrl.protocol)) {
    throw new OfflineDocumentEngineError('invalid_asset_location');
  }
  return Object.freeze({
    root: rootUrl.href,
    pdfModule: safeAssetUrl('pdfjs/pdf.min.mjs', rootUrl),
    pdfWorker: safeAssetUrl('pdfjs/pdf.worker.min.mjs', rootUrl),
    pdfStandardFonts: ensureTrailingSlash(safeAssetUrl('pdfjs/standard_fonts/', rootUrl)),
    pdfWasm: ensureTrailingSlash(safeAssetUrl('pdfjs/wasm/', rootUrl)),
    pdfImageDecoders: ensureTrailingSlash(safeAssetUrl('pdfjs/image_decoders/', rootUrl)),
    tesseractModule: safeAssetUrl('tesseract/tesseract.esm.min.js', rootUrl),
    tesseractWorker: safeAssetUrl('tesseract/worker.min.js', rootUrl),
    tesseractCore: ensureTrailingSlash(safeAssetUrl('tesseract/core/', rootUrl)),
    tesseractLanguages: ensureTrailingSlash(safeAssetUrl('tesseract/lang/', rootUrl)),
  });
}

function toPdfBytes(input) {
  const bytes = input instanceof Uint8Array
    ? new Uint8Array(input)
    : input instanceof ArrayBuffer
      ? new Uint8Array(input.slice(0))
      : null;
  if (!bytes || bytes.byteLength < 5) throw new OfflineDocumentEngineError('invalid_pdf');
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    throw new OfflineDocumentEngineError('invalid_pdf');
  }
  return bytes;
}

function countInkSamples(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 50_000)));
  let samples = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = ((y * width) + x) * 4;
      if (
        image.data[offset] < 245
        || image.data[offset + 1] < 245
        || image.data[offset + 2] < 245
      ) samples += 1;
    }
  }
  return samples;
}

function sanitizePdfFailure(error, signal) {
  if (signal?.aborted || error?.name === 'RenderingCancelledException') {
    return new OfflineDocumentEngineError('request_cancelled');
  }
  if (error instanceof OfflineDocumentEngineError) return error;
  return new OfflineDocumentEngineError('pdf_processing_failed');
}

export async function extractPdfTextAndRender(input, options = {}) {
  const signal = options.signal;
  const maxPagePixels = options.maxPagePixels ?? DEFAULT_MAX_PAGE_PIXELS;
  if (!Number.isSafeInteger(maxPagePixels) || maxPagePixels < 1_000_000) {
    throw new OfflineDocumentEngineError('invalid_resource_limit');
  }
  assertNotAborted(signal);
  const bytes = toPdfBytes(input);
  const assets = resolveOfflineDocumentAssetPaths(options.baseUrl);
  reportDiagnostic(options, 'assets_resolved');
  let loadingTask = null;
  let document = null;
  let renderTask = null;
  const abort = () => {
    renderTask?.cancel();
    void loadingTask?.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    reportDiagnostic(options, 'pdf_module_loading');
    const pdfjs = await import(/* @vite-ignore */ assets.pdfModule);
    reportDiagnostic(options, 'pdf_module_loaded');
    assertNotAborted(signal);
    pdfjs.GlobalWorkerOptions.workerSrc = assets.pdfWorker;
    reportDiagnostic(options, 'pdf_worker_configured');
    loadingTask = pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: assets.pdfStandardFonts,
      wasmUrl: assets.pdfWasm,
      imageResourcesPath: assets.pdfImageDecoders,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      maxImageSize: maxPagePixels,
      stopAtErrors: true,
      useSystemFonts: true,
      verbosity: 0,
    });
    reportDiagnostic(options, 'pdf_document_loading');
    document = await loadingTask.promise;
    reportDiagnostic(options, 'pdf_document_loaded');
    assertNotAborted(signal);
    const pageNumber = options.pageNumber ?? 1;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
      throw new OfflineDocumentEngineError('invalid_page_selection');
    }

    const page = await document.getPage(pageNumber);
    reportDiagnostic(options, 'pdf_page_loaded');
    try {
      assertNotAborted(signal);
      const textContent = await page.getTextContent({ disableNormalization: false });
      reportDiagnostic(options, 'pdf_text_extracted');
      const text = textContent.items
        .map(item => (typeof item?.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();

      const initialViewport = page.getViewport({ scale: options.scale ?? 1.5 });
      const initialPixels = initialViewport.width * initialViewport.height;
      const scaleFactor = initialPixels > maxPagePixels
        ? Math.sqrt(maxPagePixels / initialPixels)
        : 1;
      const viewport = page.getViewport({ scale: (options.scale ?? 1.5) * scaleFactor });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      if ((width * height) > maxPagePixels) {
        throw new OfflineDocumentEngineError('page_pixel_limit_exceeded');
      }

      const canvas = globalThis.document?.createElement('canvas');
      if (!canvas) throw new OfflineDocumentEngineError('canvas_unavailable');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) throw new OfflineDocumentEngineError('canvas_unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      try {
        reportDiagnostic(options, 'pdf_page_rendering');
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        reportDiagnostic(options, 'pdf_page_rendered');
        assertNotAborted(signal);
        return Object.freeze({
          pageCount: document.numPages,
          pageNumber,
          text,
          width,
          height,
          pixels: width * height,
          inkSamples: countInkSamples(context, width, height),
        });
      } finally {
        renderTask = null;
        canvas.width = 0;
        canvas.height = 0;
      }
    } finally {
      page.cleanup();
    }
  } catch (error) {
    throw sanitizePdfFailure(error, signal);
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      if (document) await document.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {}
  }
}

function sanitizeOcrFailure(error, signal) {
  if (signal?.aborted) return new OfflineDocumentEngineError('request_cancelled');
  if (error instanceof OfflineDocumentEngineError) return error;
  return new OfflineDocumentEngineError('ocr_processing_failed');
}

export function createOfflineOcrEngine(options = {}) {
  const assets = resolveOfflineDocumentAssetPaths(options.baseUrl);
  const languages = options.languages ?? ['eng', 'ind'];
  if (
    !Array.isArray(languages)
    || languages.length < 1
    || languages.some(language => !['eng', 'ind'].includes(language))
    || new Set(languages).size !== languages.length
  ) throw new OfflineDocumentEngineError('invalid_ocr_languages');

  let worker = null;
  let initializing = null;
  let disposed = false;

  async function initialize() {
    if (disposed) throw new OfflineDocumentEngineError('ocr_engine_disposed');
    if (worker) return;
    if (!initializing) {
      initializing = (async () => {
        const tesseractModule = await import(/* @vite-ignore */ assets.tesseractModule);
        const tesseract = tesseractModule.default;
        if (!tesseract || typeof tesseract.createWorker !== 'function') {
          throw new OfflineDocumentEngineError('ocr_module_invalid');
        }
        const createdWorker = await tesseract.createWorker(languages, tesseract.OEM.LSTM_ONLY, {
          cacheMethod: 'none',
          corePath: assets.tesseractCore,
          gzip: true,
          langPath: assets.tesseractLanguages,
          logger: message => {
            if (
              typeof options.onProgress === 'function'
              && typeof message?.status === 'string'
              && typeof message?.progress === 'number'
            ) options.onProgress(Object.freeze({ status: message.status, progress: message.progress }));
          },
          workerBlobURL: false,
          workerPath: assets.tesseractWorker,
        });
        if (disposed) {
          await createdWorker.terminate();
          throw new OfflineDocumentEngineError('ocr_engine_disposed');
        }
        worker = createdWorker;
      })();
    }
    try {
      await initializing;
    } catch (error) {
      initializing = null;
      throw sanitizeOcrFailure(error);
    }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    const activeWorker = worker;
    worker = null;
    if (activeWorker) await activeWorker.terminate().catch(() => {});
  }

  async function recognize(image, recognizeOptions = {}) {
    const signal = recognizeOptions.signal;
    assertNotAborted(signal);
    await initialize();
    assertNotAborted(signal);
    if (!worker) throw new OfflineDocumentEngineError('ocr_engine_unavailable');

    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => {
      rejectCancellation = reject;
    });
    const abort = () => {
      void dispose().finally(() => rejectCancellation(new OfflineDocumentEngineError('request_cancelled')));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const startedAt = performance.now();
    const recognition = worker.recognize(image).catch(error => {
      throw sanitizeOcrFailure(error, signal);
    });

    try {
      const result = await Promise.race([recognition, cancellation]);
      assertNotAborted(signal);
      return Object.freeze({
        text: String(result?.data?.text ?? '').replace(/\s+/gu, ' ').trim(),
        confidence: Number.isFinite(result?.data?.confidence) ? result.data.confidence : null,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  return Object.freeze({
    dispose,
    initialize,
    recognize,
    getStatus: () => Object.freeze({ initialized: worker !== null, disposed }),
  });
}

/**
 * Mengekstrak teks dari semua halaman PDF tanpa merender ke canvas.
 *
 * Berbeda dengan extractPdfTextAndRender(), fungsi ini:
 * - Memproses semua halaman, bukan hanya satu.
 * - Tidak mengalokasikan canvas atau bitmap — hemat RAM untuk dokumen panjang.
 * - Melaporkan progress per halaman melalui onProgress callback.
 * - Mendeteksi halaman yang kemungkinan merupakan gambar scan (teks tidak memadai).
 * - Mendukung cancellation melalui AbortSignal.
 * - Selalu melepaskan resource PDF (loadingTask/document) di blok finally.
 *
 * @param {Uint8Array|ArrayBuffer} input - Bytes PDF mentah.
 * @param {object} options
 * @param {AbortSignal} [options.signal] - Signal pembatalan.
 * @param {string} [options.baseUrl] - URL dasar untuk resolusi aset PDF.js.
 * @param {function} [options.onProgress] - Callback progress: ({ currentPage, totalPages, percent, stage })
 * @returns {Promise<object>} Hasil ekstraksi dengan detail per halaman.
 */
export async function extractPdfTextOnly(input, options = {}) {
  const signal = options.signal;
  assertNotAborted(signal);

  const bytes = toPdfBytes(input);
  const assets = resolveOfflineDocumentAssetPaths(options.baseUrl);

  function reportProgress(currentPage, totalPages, stage) {
    if (typeof options.onProgress !== 'function') return;
    const percent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
    options.onProgress(Object.freeze({ currentPage, totalPages, percent, stage }));
  }

  let loadingTask = null;
  let pdfDocument = null;

  const abort = () => {
    void loadingTask?.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    reportProgress(0, 0, 'loading_module');
    const pdfjs = await import(/* @vite-ignore */ assets.pdfModule);
    assertNotAborted(signal);

    pdfjs.GlobalWorkerOptions.workerSrc = assets.pdfWorker;

    loadingTask = pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: assets.pdfStandardFonts,
      wasmUrl: assets.pdfWasm,
      imageResourcesPath: assets.pdfImageDecoders,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: true,
      verbosity: 0,
    });

    reportProgress(0, 0, 'loading_document');
    pdfDocument = await loadingTask.promise;
    assertNotAborted(signal);

    const totalPages = pdfDocument.numPages;
    reportProgress(0, totalPages, 'document_loaded');

    const pages = [];
    let extractedPageCount = 0;
    let scannedPageCount = 0;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      assertNotAborted(signal);
      reportProgress(pageNumber - 1, totalPages, 'extracting_text');

      const page = await pdfDocument.getPage(pageNumber);
      let pageText = '';
      try {
        const textContent = await page.getTextContent({ disableNormalization: false });
        assertNotAborted(signal);

        // Gabungkan item teks dengan mempertahankan urutan halaman.
        // Gunakan pemisah spasi antar item dan baris baru antar blok (hasEOL).
        const parts = [];
        for (const item of textContent.items) {
          if (typeof item?.str !== 'string') continue;
          const str = item.str;
          if (!str) continue;
          parts.push(str);
          // hasEOL menandai akhir baris dalam PDF — tambahkan newline agar
          // teks lebih mudah dibaca dan tidak menyatukan kata sembarangan.
          if (item.hasEOL) parts.push('\n');
        }
        pageText = parts.join('').replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
      } finally {
        page.cleanup();
      }

      // Halaman dianggap punya teks bermakna hanya jika karakter non-spasi
      // melebihi ambang batas minimum. Ini mencegah halaman scan yang hanya
      // menghasilkan beberapa karakter noise dianggap sebagai halaman teks asli.
      const nonSpaceChars = pageText.replace(/\s/gu, '').length;
      const hasText = nonSpaceChars >= MIN_MEANINGFUL_TEXT_CHARS;

      if (hasText) extractedPageCount += 1;
      else scannedPageCount += 1;

      pages.push(Object.freeze({ pageNumber, text: pageText, hasText }));
      reportProgress(pageNumber, totalPages, 'page_done');
    }

    assertNotAborted(signal);
    reportProgress(totalPages, totalPages, 'completed');

    // Gabungkan teks dari halaman yang berhasil diekstrak saja, dengan
    // pemisah halaman agar hasil mudah dibaca dan tidak menyatukan konten.
    const extractedPages = pages.filter(page => page.hasText);
    const combinedText = extractedPages
      .map(page => (totalPages > 1 ? `[Halaman ${page.pageNumber}]\n${page.text}` : page.text))
      .join('\n\n');

    return Object.freeze({
      pageCount: totalPages,
      extractedPageCount,
      scannedPageCount,
      isPartial: scannedPageCount > 0 && extractedPageCount > 0,
      isAllScanned: scannedPageCount > 0 && extractedPageCount === 0,
      pages,
      combinedText,
    });
  } catch (error) {
    throw sanitizePdfFailure(error, signal);
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      if (pdfDocument) await pdfDocument.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {}
  }
}

/**
 * Memproses dokumen PDF secara offline secara komprehensif (Tahap B4):
 * - Membaca teks asli dari setiap halaman via PDF.js.
 * - Jika teks asli memadai (>= MIN_MEANINGFUL_TEXT_CHARS), gunakan teks asli tanpa OCR (hemat CPU & memori).
 * - Jika teks asli tidak memadai (halaman gambar/scan), render halaman tersebut ke canvas dan jalankan Tesseract OCR lokal.
 * - OCR Worker diinisialisasi secara lazy dan dipakai ulang secara serial antar halaman scan, lalu di-dispose di blok finally.
 * - Catat sumber hasil tiap halaman: 'text', 'ocr', atau 'empty'.
 * - Mendukung cancellation deterministik via AbortSignal dan pelaporan progress per halaman nyata.
 *
 * @param {Uint8Array|ArrayBuffer} input - Bytes PDF mentah.
 * @param {object} options
 * @param {AbortSignal} [options.signal] - Signal pembatalan.
 * @param {string} [options.baseUrl] - URL dasar untuk resolusi aset PDF.js & Tesseract.
 * @param {string[]} [options.languages] - Bahasa OCR (default: ['eng', 'ind']).
 * @param {number} [options.maxPagePixels] - Batas piksel render per halaman (default: 6_000_000).
 * @param {function} [options.onProgress] - Callback progress: ({ stage, currentPage, totalPages, percent, ocrActive })
 * @returns {Promise<object>} Hasil pemrosesan komprehensif per halaman dan agregat.
 */
export async function processPdfDocumentOffline(input, options = {}) {
  const signal = options.signal;
  assertNotAborted(signal);

  const maxPagePixels = options.maxPagePixels ?? 6_000_000;
  if (!Number.isSafeInteger(maxPagePixels) || maxPagePixels < 1_000_000) {
    throw new OfflineDocumentEngineError('invalid_resource_limit');
  }

  const bytes = toPdfBytes(input);
  const assets = resolveOfflineDocumentAssetPaths(options.baseUrl);

  function reportProgress(currentPage, totalPages, stage, percentOverride = null, ocrActive = false) {
    if (typeof options.onProgress !== 'function') return;
    let percent;
    if (percentOverride !== null) {
      percent = percentOverride;
    } else if (totalPages > 0) {
      percent = Math.min(99, Math.max(5, Math.round((currentPage / totalPages) * 100)));
    } else {
      percent = 0;
    }
    options.onProgress(Object.freeze({
      currentPage,
      totalPages,
      percent,
      stage,
      ocrActive,
    }));
  }

  let loadingTask = null;
  let pdfDocument = null;
  let ocrEngine = null;
  let currentRenderTask = null;

  const abort = () => {
    currentRenderTask?.cancel();
    void loadingTask?.destroy();
    void ocrEngine?.dispose();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    reportProgress(0, 0, 'loading_module', 5, false);
    const pdfjs = await import(/* @vite-ignore */ assets.pdfModule);
    assertNotAborted(signal);

    pdfjs.GlobalWorkerOptions.workerSrc = assets.pdfWorker;

    loadingTask = pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: assets.pdfStandardFonts,
      wasmUrl: assets.pdfWasm,
      imageResourcesPath: assets.pdfImageDecoders,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      maxImageSize: maxPagePixels,
      stopAtErrors: true,
      useSystemFonts: true,
      verbosity: 0,
    });

    reportProgress(0, 0, 'loading_document', 10, false);
    pdfDocument = await loadingTask.promise;
    assertNotAborted(signal);

    const totalPages = pdfDocument.numPages;
    reportProgress(0, totalPages, 'document_loaded', 15, false);

    const pages = [];
    let textPageCount = 0;
    let ocrPageCount = 0;
    let emptyPageCount = 0;
    const ocrConfidences = [];

    // Helper untuk inisialisasi lazy OCR engine
    async function getOcrEngine() {
      if (ocrEngine) return ocrEngine;
      ocrEngine = createOfflineOcrEngine({
        baseUrl: options.baseUrl,
        languages: options.languages ?? ['eng', 'ind'],
      });
      await ocrEngine.initialize();
      return ocrEngine;
    }

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      assertNotAborted(signal);
      const basePercent = 15 + Math.round(((pageNumber - 1) / totalPages) * 80);
      reportProgress(pageNumber, totalPages, 'extracting_text', basePercent, false);

      const page = await pdfDocument.getPage(pageNumber);
      let pageText = '';
      try {
        const textContent = await page.getTextContent({ disableNormalization: false });
        assertNotAborted(signal);

        const parts = [];
        for (const item of textContent.items) {
          if (typeof item?.str !== 'string') continue;
          const str = item.str;
          if (!str) continue;
          parts.push(str);
          if (item.hasEOL) parts.push('\n');
        }
        pageText = parts.join('').replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
      } finally {
        page.cleanup();
      }

      const nonSpaceChars = pageText.replace(/\s/gu, '').length;
      const hasNativeText = nonSpaceChars >= MIN_MEANINGFUL_TEXT_CHARS;

      if (hasNativeText) {
        // Halaman memiliki teks asli memadai: lewati OCR
        textPageCount += 1;
        pages.push(Object.freeze({
          pageNumber,
          source: 'text',
          hasText: true,
          text: pageText,
          confidence: null,
        }));
        reportProgress(pageNumber, totalPages, 'page_completed', basePercent + Math.round(80 / totalPages), false);
      } else {
        // Halaman tidak memiliki teks asli memadai: lakukan render dan OCR
        assertNotAborted(signal);
        reportProgress(pageNumber, totalPages, 'rendering_page', basePercent + Math.round(20 / totalPages), true);

        // Ambil kembali page untuk dirender
        const renderPage = await pdfDocument.getPage(pageNumber);
        let ocrResult = null;
        try {
          const initialViewport = renderPage.getViewport({ scale: options.scale ?? 1.5 });
          const initialPixels = initialViewport.width * initialViewport.height;
          const scaleFactor = initialPixels > maxPagePixels
            ? Math.sqrt(maxPagePixels / initialPixels)
            : 1;
          const viewport = renderPage.getViewport({ scale: (options.scale ?? 1.5) * scaleFactor });
          const width = Math.max(1, Math.ceil(viewport.width));
          const height = Math.max(1, Math.ceil(viewport.height));

          const canvas = globalThis.document?.createElement('canvas');
          if (!canvas) throw new OfflineDocumentEngineError('canvas_unavailable');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
          if (!context) throw new OfflineDocumentEngineError('canvas_unavailable');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);

          try {
            currentRenderTask = renderPage.render({ canvas, canvasContext: context, viewport });
            await currentRenderTask.promise;
            assertNotAborted(signal);

            reportProgress(pageNumber, totalPages, 'recognizing_ocr', basePercent + Math.round(40 / totalPages), true);
            const engine = await getOcrEngine();
            assertNotAborted(signal);

            ocrResult = await engine.recognize(canvas, { signal });
            assertNotAborted(signal);
          } finally {
            currentRenderTask = null;
            canvas.width = 0;
            canvas.height = 0;
          }
        } finally {
          renderPage.cleanup();
        }

        const ocrText = (ocrResult?.text ?? '').trim();
        const ocrNonSpaceChars = ocrText.replace(/\s/gu, '').length;
        const hasOcrText = ocrNonSpaceChars >= MIN_MEANINGFUL_TEXT_CHARS;

        if (hasOcrText) {
          ocrPageCount += 1;
          if (Number.isFinite(ocrResult.confidence) && ocrResult.confidence >= 0) {
            ocrConfidences.push(ocrResult.confidence);
          }
          pages.push(Object.freeze({
            pageNumber,
            source: 'ocr',
            hasText: true,
            text: ocrText,
            confidence: ocrResult.confidence,
          }));
        } else {
          emptyPageCount += 1;
          pages.push(Object.freeze({
            pageNumber,
            source: 'empty',
            hasText: false,
            text: '',
            confidence: null,
          }));
        }
        reportProgress(pageNumber, totalPages, 'page_completed', basePercent + Math.round(80 / totalPages), true);
      }
    }

    assertNotAborted(signal);
    reportProgress(totalPages, totalPages, 'completed', 100, false);

    const hasAnyText = textPageCount > 0 || ocrPageCount > 0;
    const isTextOnly = textPageCount > 0 && ocrPageCount === 0 && emptyPageCount === 0;
    const isAllScanned = textPageCount === 0 && ocrPageCount > 0;
    const isHybrid = textPageCount > 0 && ocrPageCount > 0;
    const isAllEmpty = !hasAnyText;

    const averageConfidence = ocrConfidences.length > 0
      ? Math.round(ocrConfidences.reduce((sum, c) => sum + c, 0) / ocrConfidences.length)
      : null;

    // Gabungkan teks dari halaman yang memiliki teks (baik teks asli maupun OCR)
    const textPages = pages.filter(p => p.hasText);
    const combinedText = textPages
      .map(p => (totalPages > 1 ? `[Halaman ${p.pageNumber}${p.source === 'ocr' ? ' · OCR' : ''}]\n${p.text}` : p.text))
      .join('\n\n');

    return Object.freeze({
      pageCount: totalPages,
      textPageCount,
      ocrPageCount,
      emptyPageCount,
      hasText: hasAnyText,
      isTextOnly,
      isAllScanned,
      isHybrid,
      isAllEmpty,
      averageConfidence,
      pages,
      combinedText,
    });
  } catch (error) {
    if (signal?.aborted) throw new OfflineDocumentEngineError('request_cancelled');
    if (error instanceof OfflineDocumentEngineError) throw error;
    throw sanitizePdfFailure(error, signal);
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      if (ocrEngine) await ocrEngine.dispose();
    } catch {}
    try {
      if (pdfDocument) await pdfDocument.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {}
  }
}


/**
 * Mengenali teks dari file atau elemen gambar menggunakan Tesseract.js lokal.
 *
 * Mendukung:
 * - Bahasa campuran Indonesia ('ind') dan Inggris ('eng').
 * - Pelaporan progress nyata (membaca, menyiapkan OCR, mengenali teks, selesai).
 * - Pembatalan segera via AbortSignal.
 * - Pembersihan worker otomatis di blok finally untuk mencegah kebocoran memori.
 *
 * @param {Blob|File|HTMLCanvasElement|ImageData} input - Sumber gambar untuk OCR.
 * @param {object} options
 * @param {AbortSignal} [options.signal] - Signal pembatalan.
 * @param {string} [options.baseUrl] - URL dasar untuk resolusi aset Tesseract lokal.
 * @param {string[]} [options.languages] - Bahasa OCR (default: ['eng', 'ind']).
 * @param {function} [options.onProgress] - Callback progress: ({ stage, percent, status })
 * @returns {Promise<object>} Hasil pengenalan teks: { text, confidence, durationMs, hasText }.
 */
export async function recognizeImageText(input, options = {}) {
  const signal = options.signal;
  assertNotAborted(signal);

  function reportProgress(stage, percent, status) {
    if (typeof options.onProgress === 'function') {
      options.onProgress(Object.freeze({ stage, percent, status }));
    }
  }

  reportProgress('reading_image', 10, 'reading_image');
  assertNotAborted(signal);

  const engine = createOfflineOcrEngine({
    baseUrl: options.baseUrl,
    languages: options.languages ?? ['eng', 'ind'],
    onProgress: update => {
      let stage = 'recognizing_text';
      let percent = 30;
      const status = typeof update?.status === 'string' ? update.status : '';
      const p = typeof update?.progress === 'number' ? update.progress : 0;
      if (status.includes('loading') || status.includes('init')) {
        stage = 'preparing_ocr';
        percent = 20 + Math.round(p * 20);
      } else if (status.includes('recognizing')) {
        stage = 'recognizing_text';
        percent = 40 + Math.round(p * 55);
      }
      reportProgress(stage, Math.min(99, Math.max(10, percent)), status);
    },
  });

  try {
    reportProgress('preparing_ocr', 20, 'initializing_engine');
    await engine.initialize();
    assertNotAborted(signal);

    reportProgress('recognizing_text', 40, 'recognizing');
    const result = await engine.recognize(input, { signal });
    assertNotAborted(signal);

    reportProgress('completed', 100, 'done');
    const nonSpaceChars = result.text.replace(/\s/gu, '').length;
    const hasText = nonSpaceChars >= MIN_MEANINGFUL_TEXT_CHARS;

    return Object.freeze({
      text: result.text,
      confidence: result.confidence,
      durationMs: result.durationMs,
      hasText,
    });
  } catch (error) {
    if (signal?.aborted) throw new OfflineDocumentEngineError('request_cancelled');
    if (error instanceof OfflineDocumentEngineError) throw error;
    throw sanitizeOcrFailure(error, signal);
  } finally {
    try {
      await engine.dispose();
    } catch {}
  }
}

