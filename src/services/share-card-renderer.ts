import QRCode from 'qrcode';

import { extractHostname } from '../core/categorizer';
import {
    TAB_GROUP_COLOR_HEX,
    type ShareCardTheme,
    type ShareItem,
    type TabGroupColor,
} from '../core/types';
import { getFaviconUrl } from './browser-bridge';

export interface SingleCardRenderOptions {
    title: string;
    url: string;
    description?: string;
    theme: ShareCardTheme;
    showDescription: boolean;
    showWatermark: boolean;
}

export interface GroupCardRenderOptions {
    title: string;
    description?: string;
    color?: TabGroupColor;
    items: ShareItem[];
    shareUrl: string;
    qrSupported: boolean;
    theme: ShareCardTheme;
    showDescriptions: boolean;
    showWatermark: boolean;
}

interface Palette {
    outerBg: string;
    glowA?: string;
    glowB?: string;
    cardBg: string;
    cardBorder: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    pillBg: string;
    rowBg: string;
}

const PALETTES: Record<ShareCardTheme, Palette> = {
    dark: {
        outerBg: '#181a1f',
        cardBg: '#23262e',
        cardBorder: '#353945',
        textPrimary: '#f3f4f6',
        textSecondary: '#b6bcc8',
        textMuted: '#868d9b',
        accent: '#d2a400',
        pillBg: 'rgba(210, 164, 0, 0.16)',
        rowBg: 'rgba(255, 255, 255, 0.04)',
    },
    light: {
        outerBg: '#eef2f6',
        cardBg: '#ffffff',
        cardBorder: '#dce2ec',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        textMuted: '#64748b',
        accent: '#d97706',
        pillBg: 'rgba(217, 119, 6, 0.12)',
        rowBg: '#f8fafc',
    },
    aurora: {
        outerBg: '#0b1120',
        glowA: 'rgba(56, 189, 248, 0.25)',
        glowB: 'rgba(210, 164, 0, 0.22)',
        cardBg: 'rgba(18, 26, 46, 0.9)',
        cardBorder: 'rgba(148, 163, 184, 0.24)',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#94a3b8',
        accent: '#38bdf8',
        pillBg: 'rgba(56, 189, 248, 0.16)',
        rowBg: 'rgba(255, 255, 255, 0.05)',
    },
    minimal: {
        outerBg: '#fafaf9',
        cardBg: '#fafaf9',
        cardBorder: '#d6d3d1',
        textPrimary: '#1c1917',
        textSecondary: '#57534e',
        textMuted: '#78716c',
        accent: '#1c1917',
        pillBg: '#e7e5e4',
        rowBg: '#f5f5f4',
    },
};

const FONT_STACK =
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function wrapCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number,
): string[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];

    const lines: string[] = [];
    let current = '';

    for (const ch of clean) {
        const next = current + ch;
        if (ctx.measureText(next).width <= maxWidth) {
            current = next;
            continue;
        }
        // Try breaking on last space for English prose if reasonable
        const lastSpace = current.lastIndexOf(' ');
        if (lastSpace > current.length * 0.45) {
            lines.push(current.slice(0, lastSpace));
            current = current.slice(lastSpace + 1) + ch;
        } else {
            lines.push(current);
            current = ch;
        }
        if (lines.length === maxLines) {
            let tail = lines[maxLines - 1]!;
            while (tail.length > 1 && ctx.measureText(`${tail}…`).width > maxWidth) {
                tail = tail.slice(0, -1);
            }
            lines[maxLines - 1] = `${tail}…`;
            return lines;
        }
    }

    if (current) {
        lines.push(current);
    }
    return lines.slice(0, maxLines);
}

async function loadSameOriginFavicon(url: string): Promise<HTMLImageElement | null> {
    if (typeof Image === 'undefined') return null;
    const src = getFaviconUrl(url);
    if (!src.startsWith('chrome-extension://') && !src.startsWith('extension://')) {
        return null;
    }

    return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => resolve(null), 1200);
        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
        };
        img.src = src;
    });
}

function drawQrCodeBox(
    ctx: CanvasRenderingContext2D,
    text: string,
    boxX: number,
    boxY: number,
    boxSize: number,
): void {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size;
    const padding = 14;

    ctx.save();
    roundRectPath(ctx, boxX, boxY, boxSize, boxSize, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const inner = boxSize - padding * 2;
    const cell = inner / moduleCount;
    ctx.fillStyle = '#111827';

    for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
            if (qr.modules.get(r, c)) {
                const mx = boxX + padding + c * cell;
                const my = boxY + padding + r * cell;
                ctx.fillRect(mx, my, Math.ceil(cell), Math.ceil(cell));
            }
        }
    }
    ctx.restore();
}

function drawCardBackdrop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: Palette,
): void {
    ctx.fillStyle = palette.outerBg;
    ctx.fillRect(0, 0, width, height);

    if (palette.glowA) {
        const g1 = ctx.createRadialGradient(80, 40, 20, 120, 80, 380);
        g1.addColorStop(0, palette.glowA);
        g1.addColorStop(1, 'transparent');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height);
    }
    if (palette.glowB) {
        const g2 = ctx.createRadialGradient(width - 80, height - 40, 20, width - 80, height - 40, 360);
        g2.addColorStop(0, palette.glowB);
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height);
    }

    const pad = 22;
    roundRectPath(ctx, pad, pad, width - pad * 2, height - pad * 2, 18);
    ctx.fillStyle = palette.cardBg;
    ctx.fill();
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 1.25;
    ctx.stroke();
}

export async function renderSingleUrlCardCanvas(
    options: SingleCardRenderOptions,
): Promise<HTMLCanvasElement> {
    const W = 760;
    const H = 380;
    const DPR = 2;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(DPR, DPR);

    const palette = PALETTES[options.theme];
    drawCardBackdrop(ctx, W, H, palette);

    const host = extractHostname(options.url) || 'link';
    const leftX = 52;
    const contentW = 430;

    // Favicon + Domain pill
    const faviconImg = await loadSameOriginFavicon(options.url);
    ctx.save();
    roundRectPath(ctx, leftX, 52, 40, 40, 10);
    ctx.fillStyle = palette.pillBg;
    ctx.fill();
    if (faviconImg) {
        ctx.drawImage(faviconImg, leftX + 8, 60, 24, 24);
    } else {
        ctx.fillStyle = palette.accent;
        ctx.font = `700 18px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((host[0] ?? 'L').toUpperCase(), leftX + 20, 73);
    }
    ctx.restore();

    // Host pill next to icon
    ctx.save();
    ctx.font = `600 12px ${FONT_STACK}`;
    const hostLabel = host.length > 32 ? `${host.slice(0, 31)}…` : host;
    const hostW = ctx.measureText(hostLabel).width + 20;
    roundRectPath(ctx, leftX + 52, 60, hostW, 24, 12);
    ctx.fillStyle = palette.pillBg;
    ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.textBaseline = 'middle';
    ctx.fillText(hostLabel, leftX + 62, 72);
    ctx.restore();

    // Title
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `700 22px ${FONT_STACK}`;
    ctx.textBaseline = 'top';
    const titleLines = wrapCanvasText(
        ctx,
        options.title || host,
        contentW,
        options.showDescription && options.description ? 3 : 4,
    );
    let y = 114;
    for (const line of titleLines) {
        ctx.fillText(line, leftX, y);
        y += 30;
    }

    // Optional one-line description
    if (options.showDescription && options.description?.trim()) {
        y += 6;
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `400 14px ${FONT_STACK}`;
        const descLines = wrapCanvasText(ctx, options.description.trim(), contentW, 3);
        for (const line of descLines) {
            ctx.fillText(line, leftX, y);
            y += 21;
        }
    }

    // Truncated full URL at bottom-left
    ctx.fillStyle = palette.textMuted;
    ctx.font = `400 11px ${FONT_STACK}`;
    const urlLines = wrapCanvasText(ctx, options.url, contentW, 1);
    if (urlLines[0]) {
        ctx.fillText(urlLines[0], leftX, H - 64);
    }

    // Watermark
    if (options.showWatermark) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `600 11px ${FONT_STACK}`;
        ctx.fillText('Link Map · Local Share Card', leftX, H - 44);
    }

    // QR Code on right
    const qrSize = 200;
    const qrX = W - 52 - qrSize;
    const qrY = 74;
    drawQrCodeBox(ctx, options.url, qrX, qrY, qrSize);

    ctx.fillStyle = palette.textMuted;
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText('Scan to Open', qrX + qrSize / 2, qrY + qrSize + 14);
    ctx.textAlign = 'left';

    return canvas;
}

export async function renderGroupShareCardCanvas(
    options: GroupCardRenderOptions,
): Promise<HTMLCanvasElement> {
    const W = 780;
    const H = 460;
    const DPR = 2;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(DPR, DPR);

    const palette = PALETTES[options.theme];
    drawCardBackdrop(ctx, W, H, palette);

    const leftX = 48;
    const leftW = options.qrSupported ? 445 : 684;
    const groupColor = options.color ? TAB_GROUP_COLOR_HEX[options.color] : palette.accent;

    // Group dot + badge
    ctx.save();
    roundRectPath(ctx, leftX, 50, 14, 14, 4);
    ctx.fillStyle = groupColor;
    ctx.fill();

    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${options.items.length} links`, leftX + 24, 57);
    ctx.restore();

    // Title
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `700 21px ${FONT_STACK}`;
    ctx.textBaseline = 'top';
    const titleLines = wrapCanvasText(ctx, options.title || 'Shared Group', leftW, 1);
    if (titleLines[0]) {
        ctx.fillText(titleLines[0], leftX, 74);
    }

    let listStartY = 112;
    if (options.description?.trim()) {
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `400 13px ${FONT_STACK}`;
        const dLines = wrapCanvasText(ctx, options.description.trim(), leftW, 1);
        if (dLines[0]) {
            ctx.fillText(dLines[0], leftX, 104);
            listStartY = 132;
        }
    }

    // Preview items (up to 5)
    const maxItems = 5;
    const previewItems = options.items.slice(0, maxItems);
    const rowH = 44;
    previewItems.forEach((item, idx) => {
        const ry = listStartY + idx * (rowH + 6);
        ctx.save();
        roundRectPath(ctx, leftX, ry, leftW, rowH, 8);
        ctx.fillStyle = palette.rowBg;
        ctx.fill();

        const host = extractHostname(item.url) || 'link';
        ctx.fillStyle = palette.textPrimary;
        ctx.font = `600 12px ${FONT_STACK}`;
        const itemTitle = wrapCanvasText(ctx, item.title || host, leftW - 24, 1)[0] ?? host;
        ctx.fillText(itemTitle, leftX + 12, ry + 8);

        const subText =
            options.showDescriptions && item.description
                ? `${host} · ${item.description}`
                : host;
        ctx.fillStyle = palette.textMuted;
        ctx.font = `400 11px ${FONT_STACK}`;
        const subLine = wrapCanvasText(ctx, subText, leftW - 24, 1)[0] ?? host;
        ctx.fillText(subLine, leftX + 12, ry + 25);
        ctx.restore();
    });

    if (options.items.length > maxItems) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `500 11px ${FONT_STACK}`;
        ctx.fillText(
            `+ ${options.items.length - maxItems} more links in bundle`,
            leftX,
            listStartY + maxItems * (rowH + 6) + 2,
        );
    }

    if (options.qrSupported) {
        const qrSize = 204;
        const qrX = W - 48 - qrSize;
        const qrY = 104;
        drawQrCodeBox(ctx, options.shareUrl, qrX, qrY, qrSize);

        ctx.fillStyle = palette.textMuted;
        ctx.font = `500 11px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.fillText('Scan to Open Bundle', qrX + qrSize / 2, qrY + qrSize + 14);
        ctx.textAlign = 'left';
    }

    if (options.showWatermark) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `600 11px ${FONT_STACK}`;
        ctx.fillText('Link Map · Zero-Server Tab Share', leftX, H - 44);
    }

    return canvas;
}

export async function renderStandaloneQrDataUrl(text: string, width = 220): Promise<string> {
    return QRCode.toDataURL(text, {
        width,
        margin: 2,
        errorCorrectionLevel: 'M',
    });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to encode PNG'));
        }, 'image/png');
    });
}

export async function copyCanvasAsPng(canvas: HTMLCanvasElement): Promise<void> {
    const blob = await canvasToPngBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function downloadCanvasAsPng(
    canvas: HTMLCanvasElement,
    filename: string,
): Promise<void> {
    const blob = await canvasToPngBlob(canvas);
    const url = URL.createObjectURL(blob);
    try {
        if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
            await chrome.downloads.download({ url, filename, saveAs: true });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
        }
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}
