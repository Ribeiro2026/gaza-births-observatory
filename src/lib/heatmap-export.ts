export interface HeatmapExportCell {
  text: string;
  bg: string;
  fg: string;
  subtext?: string;
}

export interface HeatmapExportOptions {
  title: string;
  subtitle: string;
  activeFiltersLabel: string;
  rowLabels: string[];
  colLabels: string[];
  grid: Array<Array<HeatmapExportCell>>;
  legendLabel: string;
  legendSwatches: Array<{ color: string; label: string }>;
  filename: string;
}

/**
 * Renders an editorial 2x retina PNG of any matrix heatmap (Calendar or Source x Period)
 * with header metadata, exact tabular cell values, color legend, and provenance watermark.
 */
export async function exportHeatmapToPng(options: HeatmapExportOptions): Promise<void> {
  const {
    title,
    subtitle,
    activeFiltersLabel,
    rowLabels,
    colLabels,
    grid,
    legendLabel,
    legendSwatches,
    filename,
  } = options;

  const scale = 2;
  const padX = 48;
  const headerHeight = 114;
  const legendHeight = 46;
  const colHeaderHeight = 34;
  const footerHeight = 58;

  const rowLabelWidth = Math.max(
    110,
    Math.min(180, Math.max(...rowLabels.map((l) => l.length * 7.5 + 24), 110))
  );
  const cellGap = 4;
  const cellW = colLabels.length > 14 ? 54 : 68;
  const cellH = 42;

  const gridWidth = colLabels.length * (cellW + cellGap);
  const gridHeight = rowLabels.length * (cellH + cellGap);

  const totalWidth = Math.max(880, padX * 2 + rowLabelWidth + gridWidth);
  const totalHeight =
    headerHeight + legendHeight + colHeaderHeight + gridHeight + footerHeight + 24;

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

  // Outer hairline border
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, totalWidth - 1, totalHeight - 1);

  // Deep Lapis top rule
  ctx.fillStyle = '#1E3A8A';
  ctx.fillRect(0, 0, totalWidth, 3);

  // Header typography
  ctx.fillStyle = '#0F172A';
  ctx.font = '600 22px "Fraunces", Georgia, serif';
  ctx.fillText(title, padX, 44);

  ctx.fillStyle = '#475569';
  ctx.font = '400 13px "Public Sans", -apple-system, sans-serif';
  ctx.fillText(subtitle, padX, 68);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 11px "IBM Plex Mono", monospace';
  ctx.fillText(`Filters: ${activeFiltersLabel}`, padX, 90);

  // Divider
  ctx.strokeStyle = '#E2E8F0';
  ctx.beginPath();
  ctx.moveTo(padX, 104);
  ctx.lineTo(totalWidth - padX, 104);
  ctx.stroke();

  // Legend ramp
  let lx = padX;
  const ly = 128;
  ctx.fillStyle = '#475569';
  ctx.font = '500 11px "Public Sans", -apple-system, sans-serif';
  ctx.fillText(legendLabel, lx, ly);
  lx += ctx.measureText(legendLabel).width + 16;

  ctx.font = '500 10.5px "IBM Plex Mono", monospace';
  for (const sw of legendSwatches) {
    ctx.fillStyle = sw.color;
    ctx.fillRect(lx, ly - 10, 14, 12);
    ctx.strokeStyle = '#CBD5E1';
    ctx.strokeRect(lx + 0.5, ly - 9.5, 13, 11);
    ctx.fillStyle = '#334155';
    ctx.fillText(sw.label, lx + 19, ly);
    lx += ctx.measureText(sw.label).width + 32;
  }

  // Matrix origin
  const originX = padX + rowLabelWidth;
  const originY = headerHeight + legendHeight + colHeaderHeight;

  // Column labels
  ctx.fillStyle = '#475569';
  ctx.font = '500 10.5px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  colLabels.forEach((col, cIdx) => {
    const cx = originX + cIdx * (cellW + cellGap) + cellW / 2;
    ctx.fillText(col, cx, originY - 12);
  });

  // Rows & Cells
  rowLabels.forEach((rowLabel, rIdx) => {
    const y = originY + rIdx * (cellH + cellGap);

    // Row label
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 11.5px "Public Sans", -apple-system, sans-serif';
    const truncated = rowLabel.length > 22 ? `${rowLabel.slice(0, 21)}…` : rowLabel;
    ctx.fillText(truncated, padX, y + cellH / 2 + 4);

    // Cells
    const rowCells = grid[rIdx] || [];
    rowCells.forEach((cell, cIdx) => {
      const x = originX + cIdx * (cellW + cellGap);
      ctx.fillStyle = cell.bg;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 0.75;
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

      ctx.textAlign = 'center';
      ctx.fillStyle = cell.fg;
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillText(cell.text, x + cellW / 2, y + (cell.subtext ? 19 : 25));

      if (cell.subtext) {
        ctx.font = '400 9px "IBM Plex Mono", monospace';
        ctx.fillText(cell.subtext, x + cellW / 2, y + 33);
      }
    });
  });

  // Footer watermark
  const footerTop = totalHeight - footerHeight;
  ctx.textAlign = 'left';
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
    footerTop + 28
  );

  const rightText = 'Heatmap Reconciliation Matrix';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(rightText, totalWidth - padX, footerTop + 28);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png', 1.0)
  );
  if (!blob) {
    throw new Error('Could not encode heatmap PNG.');
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
}
