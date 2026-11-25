export interface ChartExportOptions {
  containerEl: HTMLElement;
  title: string;
  subtitle: string;
  activeFiltersLabel: string;
  legendItems: Array<{ label: string; color: string }>;
  filename: string;
}

/**
 * High-resolution 2x Canvas PNG exporter for Recharts SVGs.
 * Composes an editorial header, inline-styled chart SVG, source legend,
 * and timestamped provenance watermark footer without relying on brittle DOM screenshots.
 */
export async function exportChartToPng(options: ChartExportOptions): Promise<void> {
  const svgEl = options.containerEl.querySelector('svg.recharts-surface') as SVGSVGElement | null;
  if (!svgEl) {
    throw new Error('Chart SVG surface is not ready for export.');
  }

  const rect = svgEl.getBoundingClientRect();
  const chartWidth = Math.max(Math.round(rect.width), 780);
  const chartHeight = Math.max(Math.round(rect.height), 360);

  // Clone SVG and inline key font/color styles for standalone rasterization
  const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clonedSvg.setAttribute('width', String(chartWidth));
  clonedSvg.setAttribute('height', String(chartHeight));

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = `
    text {
      font-family: "IBM Plex Mono", "Public Sans", -apple-system, sans-serif;
    }
  `;
  clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clonedSvg);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to render chart image onto export canvas.'));
      image.src = svgUrl;
    });

    const scale = 2;
    const padX = 48;
    const headerHeight = 112;
    const legendHeight = 42;
    const footerHeight = 64;
    const totalWidth = chartWidth + padX * 2;
    const totalHeight = headerHeight + legendHeight + chartHeight + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth * scale;
    canvas.height = totalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    ctx.scale(scale, scale);

    // Archival paper white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Subtle editorial outer border
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, totalWidth - 1, totalHeight - 1);

    // Top rule accent
    ctx.fillStyle = '#1E3A8A';
    ctx.fillRect(0, 0, totalWidth, 3);

    // Header Title
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 22px "Fraunces", Georgia, serif';
    ctx.fillText(options.title, padX, 44);

    // Subtitle
    ctx.fillStyle = '#475569';
    ctx.font = '400 13px "Public Sans", -apple-system, sans-serif';
    ctx.fillText(options.subtitle, padX, 68);

    // Active filters metadata line
    ctx.fillStyle = '#64748B';
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.fillText(`Filters: ${options.activeFiltersLabel}`, padX, 90);

    // Hairline divider
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(padX, 104);
    ctx.lineTo(totalWidth - padX, 104);
    ctx.stroke();

    // Legend row
    let legendX = padX;
    const legendY = 128;
    ctx.font = '500 11.5px "Public Sans", -apple-system, sans-serif';
    for (const item of options.legendItems) {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, legendY - 8, 12, 3);
      ctx.fillStyle = '#334155';
      ctx.fillText(item.label, legendX + 18, legendY - 2);
      const textWidth = ctx.measureText(item.label).width;
      legendX += textWidth + 36;
      if (legendX > totalWidth - padX - 100) {
        break;
      }
    }

    // Draw serialized Recharts SVG
    ctx.drawImage(img, padX, headerHeight + legendHeight, chartWidth, chartHeight);

    // Footer divider & watermark metadata
    const footerTop = headerHeight + legendHeight + chartHeight + 12;
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(padX, footerTop);
    ctx.lineTo(totalWidth - padX, footerTop);
    ctx.stroke();

    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    ctx.fillStyle = '#475569';
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.fillText(
      `Gaza Births Observatory · Exported ${generatedAt}`,
      padX,
      footerTop + 26
    );

    const rightWatermark = 'Multi-Source Demographic Reconciliation Ledger';
    const rightWidth = ctx.measureText(rightWatermark).width;
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(rightWatermark, totalWidth - padX - rightWidth, footerTop + 26);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1.0)
    );
    if (!pngBlob) {
      throw new Error('Could not encode PNG output.');
    }

    const downloadUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = options.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
