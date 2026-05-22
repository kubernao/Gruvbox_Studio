import { useEffect, useMemo, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import './PdfViewer.css';
import { IPCService } from '../../shared/utils/ipc';

interface PdfViewerProps {
  filePath: string;
  zoomScale?: number;
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

try {
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
} catch {
  // Ignore worker wiring failures; fallback path keeps old behavior.
}

export default function PdfViewer({ filePath, zoomScale = 1 }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, any>>(new Map());
  const renderGenerationRef = useRef(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [zoom, setZoom] = useState(1.2);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const stablePath = useMemo(() => filePath, [filePath]);

  useEffect(() => {
    let disposed = false;
    let loadedDoc: any = null;
    setIsLoading(true);
    setError(null);
    setPdfDoc(null);
    setPageCount(0);
    setVisiblePage(1);
    pageCanvasRefs.current.clear();
    renderTasksRef.current.forEach((task) => task?.cancel?.());
    renderTasksRef.current.clear();
    renderGenerationRef.current += 1;
    let task: any = null;
    void (async () => {
      try {
        const base64 = await IPCService.readFileBase64(stablePath);
        if (disposed) {
          return;
        }
        const bytes = decodeBase64ToUint8Array(base64);
        task = getDocument({ data: bytes, disableWorker: true } as any);
        const doc = await task.promise;
        if (disposed) {
          void doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
      } catch (err: unknown) {
        if (disposed) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(`Unable to open PDF: ${message}`);
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
      renderGenerationRef.current += 1;
      renderTasksRef.current.forEach((renderTask) => renderTask?.cancel?.());
      renderTasksRef.current.clear();
      pageCanvasRefs.current.clear();
      if (loadedDoc) {
        void loadedDoc.destroy();
      }
      task?.destroy?.();
    };
  }, [stablePath]);

  useEffect(() => {
    if (!pdfDoc) {
      return;
    }

    const generation = renderGenerationRef.current + 1;
    renderGenerationRef.current = generation;
    renderTasksRef.current.forEach((task) => task?.cancel?.());
    renderTasksRef.current.clear();

    let cancelled = false;
    (async () => {
      try {
        for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
          if (cancelled || generation !== renderGenerationRef.current) {
            return;
          }
          const page = await pdfDoc.getPage(pageNumber);
          const canvas = pageCanvasRefs.current.get(pageNumber);
          if (!canvas) {
            continue;
          }
          const baseViewport = page.getViewport({ scale: 1 });
          const containerWidth = containerRef.current?.clientWidth ?? 0;
          const scale =
            fitToWidth && containerWidth > 0
              ? Math.max(0.2, ((containerWidth - 24) / baseViewport.width) * zoomScale)
              : zoom * zoomScale;
          const viewport = page.getViewport({ scale });
          const context = canvas.getContext('2d');
          if (!context) {
            continue;
          }
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport,
          });
          renderTasksRef.current.set(pageNumber, renderTask);
          await renderTask.promise;
          renderTasksRef.current.delete(pageNumber);
        }
      } catch (err: unknown) {
        if (!cancelled && generation === renderGenerationRef.current) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Unable to render PDF page: ${message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTasksRef.current.forEach((task) => task?.cancel?.());
      renderTasksRef.current.clear();
    };
  }, [fitToWidth, pdfDoc, zoom, zoomScale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageCount <= 0) {
      return;
    }
    const handleScroll = () => {
      const centerY = container.scrollTop + container.clientHeight / 2;
      let closestPage = 1;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (let page = 1; page <= pageCount; page += 1) {
        const canvas = pageCanvasRefs.current.get(page);
        if (!canvas) {
          continue;
        }
        const pageCenter = canvas.offsetTop + canvas.clientHeight / 2;
        const distance = Math.abs(pageCenter - centerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = page;
        }
      }
      setVisiblePage(closestPage);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [pageCount]);

  const canPrev = visiblePage > 1;
  const canNext = visiblePage < pageCount;

  const jumpToPage = (targetPage: number) => {
    const nextPage = Math.min(pageCount, Math.max(1, targetPage));
    const canvas = pageCanvasRefs.current.get(nextPage);
    if (canvas) {
      canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setVisiblePage(nextPage);
  };

  return (
    <div className="pdf-viewer-root">
      <div className="pdf-viewer-toolbar">
        <button type="button" onClick={() => jumpToPage(visiblePage - 1)} disabled={!canPrev}>
          Prev
        </button>
        <span>
          Page {visiblePage} / {Math.max(pageCount, 1)}
        </span>
        <button type="button" onClick={() => jumpToPage(visiblePage + 1)} disabled={!canNext}>
          Next
        </button>
        <div className="pdf-viewer-divider" />
        <button type="button" onClick={() => { setFitToWidth(false); setZoom((z) => Math.max(0.2, z - 0.1)); }}>
          -
        </button>
        <span>{fitToWidth ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
        <button type="button" onClick={() => { setFitToWidth(false); setZoom((z) => Math.min(4, z + 0.1)); }}>
          +
        </button>
        <button type="button" onClick={() => setFitToWidth(true)}>Fit Width</button>
      </div>
      <div className="pdf-viewer-canvas-wrap" ref={containerRef}>
        {isLoading && <div className="pdf-viewer-status">Loading PDF...</div>}
        {error && <div className="pdf-viewer-status pdf-viewer-error">{error}</div>}
        {!error && pageCount > 0 && (
          <div className="pdf-viewer-pages">
            {Array.from({ length: pageCount }, (_, idx) => {
              const page = idx + 1;
              return (
                <canvas
                  key={page}
                  ref={(node) => {
                    if (node) {
                      pageCanvasRefs.current.set(page, node);
                    } else {
                      pageCanvasRefs.current.delete(page);
                    }
                  }}
                  className="pdf-viewer-canvas"
                  data-page-number={page}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
