import { useEffect, useMemo, useRef } from "react";
import { buildLabelHtml, type LabelOptions } from "@shared/label-layout";
import { fitLabelDocument } from "@/lib/print-label";

const PX_PER_MM = 96 / 25.4;

interface LabelPreviewProps {
  lines: string[];
  options: LabelOptions;
  /** Preview box the label is scaled into, in CSS pixels. */
  maxWidthPx?: number;
  maxHeightPx?: number;
}

/**
 * The label as the printer will see it, at true proportions.
 *
 * It is the same document `printAddressLabel` sends to the QL-800, rendered in
 * an iframe and scaled — so what the operator checks before hitting Print is
 * the thing that prints, down to where the type had to shrink.
 *
 * Rotation is deliberately not applied here: it exists to satisfy a driver
 * that wants the page the other way round, and the label still comes out of
 * the printer the way it is drawn below.
 */
export function LabelPreview({
  lines,
  options,
  maxWidthPx = 360,
  maxHeightPx = 210,
}: LabelPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const previewOptions = useMemo<LabelOptions>(
    () => ({ ...options, rotate: false }),
    [options],
  );
  const html = useMemo(
    () => buildLabelHtml(lines, previewOptions),
    [lines, previewOptions],
  );

  const naturalW = previewOptions.widthMm * PX_PER_MM;
  const naturalH = previewOptions.heightMm * PX_PER_MM;
  const scale = Math.min(maxWidthPx / naturalW, maxHeightPx / naturalH, 2);

  // srcDoc swaps the document under us, so re-fit on every render that changed
  // the html rather than only on first mount.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const run = () => {
      const doc = frame.contentDocument;
      if (doc) fitLabelDocument(doc, previewOptions);
    };
    frame.addEventListener("load", run);
    run();
    return () => frame.removeEventListener("load", run);
  }, [html, previewOptions]);

  return (
    <div
      className="mx-auto bg-white border border-gray-300 shadow-sm overflow-hidden"
      style={{ width: naturalW * scale, height: naturalH * scale }}
      data-testid="label-preview"
    >
      <iframe
        ref={frameRef}
        srcDoc={html}
        title="Shipping label preview"
        scrolling="no"
        style={{
          width: naturalW,
          height: naturalH,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
