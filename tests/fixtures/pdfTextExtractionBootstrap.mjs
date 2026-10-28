const bootstrapDiagnostic = {
  stage: 'bootstrap_loaded',
  code: null,
  pdfWorkerLoaded: false,
};

globalThis.getPdfTextExtractionDiagnostic = () => ({ ...bootstrapDiagnostic });

try {
  bootstrapDiagnostic.stage = 'renderer_module_loading';
  await import('./pdfTextExtractionRenderer.mjs');
  bootstrapDiagnostic.stage = 'renderer_module_loaded';
} catch (error) {
  bootstrapDiagnostic.stage = 'renderer_module_loading';
  bootstrapDiagnostic.code = error?.name === 'SyntaxError'
    ? 'renderer_module_syntax_failed'
    : 'renderer_module_load_failed';
}
