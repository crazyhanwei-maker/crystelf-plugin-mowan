import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//ART PRO 风格图标包：控制台提取的现成 SVG + IonIcons 全集（MIT，由 temp/fetch-ionicons-full.mjs 拉取生成）
const ARTD_RESOURCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resources', 'miao-help');
let fullSetCache = null;

function loadFullSet() {
  if (fullSetCache) return fullSetCache;
  try {
    fullSetCache = JSON.parse(fs.readFileSync(path.join(ARTD_RESOURCE_DIR, 'artd-icons-full.json'), 'utf8'))?.items || [];
  } catch {
    fullSetCache = [];
  }
  return fullSetCache;
}

export const ARTD_ICONS = [
  {
    "slug": "nav-系统设置",
    "name": "系统设置",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m0-2a8 8 0 1 0 0-16a8 8 0 0 0 0 16m-1-5h2v2h-2zm0-8h2v6h-2z\"/></svg>"
  },
  {
    "slug": "nav-更新日志",
    "name": "更新日志",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"m3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm5.707 7.707 2.828 2.829 6.364-6.364-1.414-1.415-4.95 4.95-1.414-1.414-1.414 1.414Z\"/></svg>"
  },
  {
    "slug": "top-menu",
    "name": "menu",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M3 4H21V6H3V4ZM3 11H15V13H3V11ZM3 18H21V20H3V18Z\"/></svg>"
  },
  {
    "slug": "top-search",
    "name": "search",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z\"/></svg>"
  },
  {
    "slug": "top-settings",
    "name": "settings",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M3.33946 17.0002C2.90721 16.2515 2.58277 15.4702 2.36133 14.6741C3.3338 14.1779 3.99972 13.1668 3.99972 12.0002C3.99972 10.8345 3.3348 9.824 2.36353 9.32741C2.81025 7.71651 3.65857 6.21627 4.86474 4.99001C5.7807 5.58416 6.98935 5.65534 7.99972 5.072C9.01009 4.48866 9.55277 3.40635 9.4962 2.31604C11.1613 1.8846 12.8847 1.90004 14.5031 2.31862C14.4475 3.40806 14.9901 4.48912 15.9997 5.072C17.0101 5.65532 18.2187 5.58416 19.1346 4.99007C19.7133 5.57986 20.2277 6.25151 20.66 7.00021C21.0922 7.7489 21.4167 8.53025 21.6381 9.32628C20.6656 9.82247 19.9997 10.8336 19.9997 12.0002C19.9997 13.166 20.6646 14.1764 21.6359 14.673C21.1892 16.2839 20.3409 17.7841 19.1347 19.0104C18.2187 18.4163 17.0101 18.3451 15.9997 18.9284C14.9893 19.5117 14.4467 20.5941 14.5032 21.6844C12.8382 22.1158 11.1148 22.1004 9.49633 21.6818C9.55191 20.5923 9.00929 19.5113 7.99972 18.9284C6.98938 18.3451 5.78079 18.4162 4.86484 19.0103C4.28617 18.4205 3.77172 17.7489 3.33946 17.0002ZM8.99972 17.1964C10.0911 17.8265 10.8749 18.8227 11.2503 19.9659C11.7486 20.0133 12.2502 20.014 12.7486 19.9675C13.1238 18.8237 13.9078 17.8268 14.9997 17.1964C16.0916 16.5659 17.347 16.3855 18.5252 16.6324C18.8146 16.224 19.0648 15.7892 19.2729 15.334C18.4706 14.4373 17.9997 13.2604 17.9997 12.0002C17.9997 10.74 18.4706 9.5632 19.2729 8.6665C19.1688 8.4405 19.0538 8.21822 18.9279 8.00021C18.802 7.78219 18.667 7.57148 18.5233 7.36842C17.3457 7.61476 16.0911 7.43414 14.9997 6.80405C13.9083 6.17395 13.1246 5.17768 12.7491 4.03455C12.2509 3.98714 11.7492 3.98646 11.2509 4.03292C10.8756 5.17671 10.0916 6.17364 8.99972 6.80405C7.9078 7.43447 6.65245 7.61494 5.47428 7.36803C5.18485 7.77641 4.93463 8.21117 4.72656 8.66637C5.52881 9.56311 5.99972 10.74 5.99972 12.0002C5.99972 13.2604 5.52883 14.4372 4.72656 15.3339C4.83067 15.5599 4.94564 15.7822 5.07152 16.0002C5.19739 16.2182 5.3324 16.4289 5.47612 16.632C6.65377 16.3857 7.90838 16.5663 8.99972 17.1964ZM11.9997 15.0002C10.3429 15.0002 8.99972 13.6571 8.99972 12.0002C8.99972 10.3434 10.3429 9.00021 11.9997 9.00021C13.6566 9.00021 14.9997 10.3434 14.9997 12.0002C14.9997 13.6571 13.6566 15.0002 11.9997 15.0002ZM11.9997 13.0002C12.552 13.0002 12.9997 12.5525 12.9997 12.0002C12.9997 11.4479 12.552 11.0002 11.9997 11.0002C11.4474 11.0002 10.9997 11.4479 10.9997 12.0002C10.9997 12.5525 11.4474 13.0002 11.9997 13.0002Z\"/></svg>"
  },
  {
    "slug": "top-bell",
    "name": "bell",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M20 17h2v2H2v-2h2v-7a8 8 0 1 1 16 0zm-2 0v-7a6 6 0 0 0-12 0v7zm-9 4h6v2H9z\"/></svg>"
  },
  {
    "slug": "top-close",
    "name": "close",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z\"/></svg>"
  },
  {
    "slug": "top-check",
    "name": "check",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z\"/></svg>"
  },
  {
    "slug": "kpi-bot",
    "name": "bot",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><rect x=\"9\" y=\"9\" width=\"6\" height=\"6\"/><line x1=\"9\" y1=\"2\" x2=\"9\" y2=\"4\"/><line x1=\"15\" y1=\"2\" x2=\"15\" y2=\"4\"/><line x1=\"9\" y1=\"20\" x2=\"9\" y2=\"22\"/><line x1=\"15\" y1=\"20\" x2=\"15\" y2=\"22\"/><line x1=\"20\" y1=\"9\" x2=\"22\" y2=\"9\"/><line x1=\"20\" y1=\"15\" x2=\"22\" y2=\"15\"/><line x1=\"2\" y1=\"9\" x2=\"4\" y2=\"9\"/><line x1=\"2\" y1=\"15\" x2=\"4\" y2=\"15\"/></svg>"
  },
  {
    "slug": "kpi-health",
    "name": "health",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M22 12h-4l-3 9L9 3l-3 9H2\"/></svg>"
  },
  {
    "slug": "kpi-zap",
    "name": "zap",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg>"
  },
  {
    "slug": "kpi-chart",
    "name": "chart",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"10\"/><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"4\"/><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"16\"/></svg>"
  },
  {
    "slug": "kpi-fail",
    "name": "fail",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"15\" y1=\"9\" x2=\"9\" y2=\"15\"/><line x1=\"9\" y1=\"9\" x2=\"15\" y2=\"15\"/></svg>"
  },
  {
    "slug": "kpi-image",
    "name": "image",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><polyline points=\"21 15 16 10 5 21\"/></svg>"
  },
  {
    "slug": "kpi-layers",
    "name": "layers",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polygon points=\"12 2 2 7 12 12 22 7 12 2\"/><polyline points=\"2 17 12 22 22 17\"/><polyline points=\"2 12 12 17 22 12\"/></svg>"
  },
  {
    "slug": "kpi-shield",
    "name": "shield",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/></svg>"
  },
  {
    "slug": "kpi-version",
    "name": "version",
    "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polyline points=\"23 4 23 10 17 10\"/><polyline points=\"1 20 1 14 7 14\"/><path d=\"M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15\"/></svg>"
  }
];

export const ARTD_ICON_MAP = new Map(ARTD_ICONS.map(item => [item.slug, item]));

export function listArtdIcons() {
  return [...ARTD_ICONS, ...loadFullSet()];
}

export function getArtdIcon(slug) {
  const clean = String(slug || '').replace(/^artd:/, '');
  return ARTD_ICON_MAP.get(clean) || loadFullSet().find(item => item.slug === clean) || null;
}

export function renderArtdIcon(slug, cssClass = 'help-icon-artd') {
  const item = getArtdIcon(slug);
  if (!item) return '';
  return item.svg.replace('<svg ', '<svg class="' + cssClass + '" ');
}
