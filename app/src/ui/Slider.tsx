/** 滑块（外观面板的自定义页用）。已走过的一段用强调色填充，用 --p 传给 CSS */
export function Slider({
  value,
  min,
  max,
  step,
  label,
  disabled,
  onChange,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  disabled?: boolean;
  onChange(v: number): void;
  testId?: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      style={{ ['--p' as string]: `${p}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
