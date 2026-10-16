export function canvasAppearance(state: { theme: string; viewBackgroundColor: string }, hasDrawing: boolean) {
  if (!hasDrawing) return 'exact-draw:appearance:light:#fbfcfa';
  const sample = document.createElement('canvas');
  sample.width = sample.height = 1;
  const context = sample.getContext('2d')!;
  context.fillStyle = state.viewBackgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  let rgb = [red, green, blue];
  if (state.theme === 'dark') {
    // excalidraw renders its canvas with invert(93%) hue-rotate(180deg).
    const [r, g, b] = rgb.map(value => 0.93 * 255 - 0.86 * value);
    rgb = [-0.574 * r + 1.43 * g + 0.144 * b, 0.426 * r + 0.43 * g + 0.144 * b, 0.426 * r + 1.43 * g - 0.856 * b];
  }
  const underlay = [251, 252, 250];
  rgb = rgb.map((value, index) => Math.round(Math.max(0, Math.min(255, value)) * alpha / 255 + underlay[index] * (1 - alpha / 255)));
  const linear = rgb.map(value => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const scheme = luminance > 0.179 ? 'light' : 'dark';
  const background = `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  return `exact-draw:appearance:${scheme}:${background}`;
}
