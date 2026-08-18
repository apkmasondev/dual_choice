import { CHOICE_HOTSPOTS, FOCUS_RECT, SOURCE_FRAME, type BranchId } from './hotspot-config.ts';
import { projectLength, projectPoint, unprojectPoint } from './mediaProjection.ts';
import type { StageGeometry, StageLayout } from '../stage/StageLayout.ts';
import type { Disposables } from '../utils/disposables.ts';

/**
 * Dev-only hotspot calibration overlay: `?calibrate=1`.
 *
 * Draws the source grid, the focus rect and each hotspot's centre and hit
 * radius on top of the real frame, and lets the values be nudged a source
 * pixel at a time and copied straight into hotspot-config.ts. Never reached in
 * a production build — main.ts guards the dynamic import with
 * `import.meta.env.DEV`, so the whole chunk is dropped.
 */

interface CalibrationPoint {
  id: BranchId;
  x: number;
  y: number;
  radius: number;
}

const STYLE = `
.calibrate{position:absolute;inset:0;z-index:90;pointer-events:none;font:11px/1.5 ui-monospace,monospace}
.calibrate canvas{position:absolute;inset:0;width:100%;height:100%}
.calibrate__panel{position:absolute;top:12px;left:50%;transform:translateX(-50%);
  background:rgba(10,12,16,.92);color:#e8ecf0;padding:10px 14px;border-radius:8px;
  pointer-events:auto;white-space:pre;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.calibrate__panel b{color:#7fd0e8}
.calibrate__panel button{margin-top:8px;background:#e8ecf0;color:#0e1114;border-radius:5px;
  padding:5px 10px;font:inherit;font-weight:600;cursor:pointer}
`;

export function startCalibration(
  stage: HTMLElement,
  layout: StageLayout,
  disposables: Disposables,
): void {
  const points: CalibrationPoint[] = CHOICE_HOTSPOTS.map((hotspot) => ({
    id: hotspot.id,
    x: hotspot.x * SOURCE_FRAME.width,
    y: hotspot.y * SOURCE_FRAME.height,
    radius: hotspot.sourceRadius,
  }));
  let active = 0;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'calibrate';
  const canvas = document.createElement('canvas');
  const panel = document.createElement('div');
  panel.className = 'calibrate__panel';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy hotspot-config values';
  root.append(canvas, panel);
  panel.append(copyButton);
  stage.append(root);

  disposables.add(() => {
    root.remove();
    style.remove();
  });

  const context = canvas.getContext('2d');

  function render(geometry: StageGeometry): void {
    if (!context) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(geometry.box.width * dpr);
    canvas.height = Math.round(geometry.box.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, geometry.box.width, geometry.box.height);

    const { rect } = geometry;

    // Source grid, every 80 source px.
    context.strokeStyle = 'rgba(20,24,30,.18)';
    context.lineWidth = 1;
    for (let x = 0; x <= SOURCE_FRAME.width; x += 80) {
      const from = projectPoint(rect, x / SOURCE_FRAME.width, 0);
      const to = projectPoint(rect, x / SOURCE_FRAME.width, 1);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    for (let y = 0; y <= SOURCE_FRAME.height; y += 80) {
      const from = projectPoint(rect, 0, y / SOURCE_FRAME.height);
      const to = projectPoint(rect, 1, y / SOURCE_FRAME.height);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }

    // Focus rect: what must never be cropped.
    const focusTopLeft = projectPoint(
      rect,
      FOCUS_RECT.x / SOURCE_FRAME.width,
      FOCUS_RECT.y / SOURCE_FRAME.height,
    );
    context.strokeStyle = '#1d6a85';
    context.setLineDash([6, 5]);
    context.lineWidth = 2;
    context.strokeRect(
      focusTopLeft.x,
      focusTopLeft.y,
      projectLength(rect, FOCUS_RECT.width),
      projectLength(rect, FOCUS_RECT.height),
    );
    context.setLineDash([]);

    points.forEach((point, index) => {
      const screen = projectPoint(
        rect,
        point.x / SOURCE_FRAME.width,
        point.y / SOURCE_FRAME.height,
      );
      const radius = projectLength(rect, point.radius);
      const selected = index === active;
      context.strokeStyle = point.id === 'blue' ? '#2f9ec4' : '#c6414a';
      context.lineWidth = selected ? 2.5 : 1.25;
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(screen.x - 10, screen.y);
      context.lineTo(screen.x + 10, screen.y);
      context.moveTo(screen.x, screen.y - 10);
      context.lineTo(screen.x, screen.y + 10);
      context.stroke();
    });

    const current = points[active];
    if (!current) return;
    panel.firstChild?.remove();
    panel.prepend(
      document.createTextNode(
        `calibration — [1]/[2] select · arrows move 1 px · shift+arrows 10 px · +/- radius\n` +
          `active: ${current.id}\n` +
          `source:      x ${current.x.toFixed(1)}  y ${current.y.toFixed(1)}  r ${String(current.radius)}\n` +
          `normalised:  x ${(current.x / SOURCE_FRAME.width).toFixed(6)}  y ${(current.y / SOURCE_FRAME.height).toFixed(6)}\n` +
          `fit: ${rect.mode}  scale ${rect.scale.toFixed(4)}  box ${Math.round(geometry.box.width)}x${Math.round(geometry.box.height)}\n` +
          `band above ${Math.round(geometry.spaceAbove)}px  below ${Math.round(geometry.spaceBelow)}px  copy ${geometry.placement}\n`,
      ),
    );
  }

  const rerender = (): void => {
    const geometry = layout.geometry;
    if (geometry) render(geometry);
  };

  layout.onChange(render);
  rerender();

  disposables.listen(globalThis.window, 'keydown', (event) => {
    const current = points[active];
    if (!current) return;
    const step = event.shiftKey ? 10 : 1;
    let handled = true;
    switch (event.key) {
      case '1':
        active = 0;
        break;
      case '2':
        active = Math.min(1, points.length - 1);
        break;
      case 'ArrowLeft':
        current.x -= step;
        break;
      case 'ArrowRight':
        current.x += step;
        break;
      case 'ArrowUp':
        current.y -= step;
        break;
      case 'ArrowDown':
        current.y += step;
        break;
      case '+':
      case '=':
        current.radius += step;
        break;
      case '-':
        current.radius = Math.max(4, current.radius - step);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      rerender();
    }
  });

  // Click anywhere on the frame to drop the active point there.
  disposables.listen(stage, 'pointerdown', (event) => {
    const geometry = layout.geometry;
    const current = points[active];
    if (!geometry || !current || event.target === copyButton) return;
    const bounds = stage.getBoundingClientRect();
    const normalised = unprojectPoint(
      geometry.rect,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
    current.x = normalised.x * SOURCE_FRAME.width;
    current.y = normalised.y * SOURCE_FRAME.height;
    rerender();
  });

  copyButton.addEventListener('click', () => {
    const snippet = points
      .map(
        (point) =>
          `  {\n    id: '${point.id}',\n` +
          `    x: ${point.x.toFixed(1)} / SOURCE_FRAME.width,\n` +
          `    y: ${point.y.toFixed(1)} / SOURCE_FRAME.height,\n` +
          `    sourceRadius: ${String(Math.round(point.radius))},\n  },`,
      )
      .join('\n');
    void navigator.clipboard.writeText(snippet).then(
      () => {
        copyButton.textContent = 'Copied';
      },
      () => {
        copyButton.textContent = 'Clipboard blocked — see console';
        console.warn(snippet);
      },
    );
  });
}
