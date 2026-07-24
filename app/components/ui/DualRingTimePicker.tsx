'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type PickerMode = 'hour' | 'minute';

type DualRingTimePickerProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
  disabled?: boolean;
};

const INNER_HOUR_VALUES = Array.from({ length: 12 }, (_, index) => index); // 0-11
const OUTER_HOUR_VALUES = Array.from({ length: 12 }, (_, index) => index + 12); // 12-23
const MINUTE_LABEL_VALUES = Array.from({ length: 12 }, (_, index) => index * 5); // 0-55 labels
const DIAL_SIZE = 264;
const DIAL_CENTER = DIAL_SIZE / 2;
const INNER_RADIUS = 68;
const OUTER_RADIUS = 108;
const MINUTE_RADIUS = 108;
const RING_THRESHOLD = 86;

const pad2 = (value: number) => String(value).padStart(2, '0');

const parseTime = (value: string): { hour: number; minute: number } => {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return { hour: 19, minute: 0 };
  }

  const [hourRaw, minuteRaw] = value.split(':').map(Number);
  const hour = Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 19;
  const minute = Number.isInteger(minuteRaw) && minuteRaw >= 0 && minuteRaw <= 59 ? minuteRaw : 0;

  return { hour, minute };
};

const toLabel12 = (value: string): string => {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return '--:--';
  }

  const [hour24, minute] = value.split(':').map(Number);
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${pad2(minute)} ${suffix}`;
};

const toPoint = (index: number, total: number, radius: number) => {
  const angle = ((index / total) * Math.PI * 2) - Math.PI / 2;
  return {
    x: DIAL_CENTER + Math.cos(angle) * radius,
    y: DIAL_CENTER + Math.sin(angle) * radius,
  };
};

const getPointerData = (
  event: PointerEvent | React.PointerEvent,
  dialElement: HTMLDivElement
) => {
  const bounds = dialElement.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const dx = x - DIAL_CENTER;
  const dy = y - DIAL_CENTER;
  const radius = Math.sqrt((dx * dx) + (dy * dy));
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) {
    angle += Math.PI * 2;
  }

  return { angle, radius };
};

const angleToStep = (angle: number, divisions: number): number => {
  const stepSize = (Math.PI * 2) / divisions;
  return Math.round(angle / stepSize) % divisions;
};

export default function DualRingTimePicker({ id, label, value, onChange, hideLabel = false, disabled = false }: DualRingTimePickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>('hour');
  const [draftHour, setDraftHour] = useState(19);
  const [draftMinute, setDraftMinute] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const parsed = parseTime(value);
    setDraftHour(parsed.hour);
    setDraftMinute(parsed.minute);
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current) {
        return;
      }

      if (!pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const displayText = useMemo(() => toLabel12(value), [value]);

  const applyTime = (hour: number, minute: number) => {
    onChange(`${pad2(hour)}:${pad2(minute)}`);
  };

  const pointerPoint = useMemo(() => {
    if (mode === 'hour') {
      const index = draftHour % 12;
      const radius = draftHour < 12 ? INNER_RADIUS : OUTER_RADIUS;
      return toPoint(index, 12, radius);
    }

    return toPoint(draftMinute, 60, MINUTE_RADIUS);
  }, [mode, draftHour, draftMinute]);

  const updateFromPointer = (event: PointerEvent | React.PointerEvent, finalize: boolean) => {
    if (!dialRef.current) {
      return;
    }

    const pointer = getPointerData(event, dialRef.current);

    if (mode === 'hour') {
      const step = angleToStep(pointer.angle, 12);
      const nextHour = pointer.radius < RING_THRESHOLD ? INNER_HOUR_VALUES[step] : OUTER_HOUR_VALUES[step];
      setDraftHour(nextHour);
      if (finalize) {
        setMode('minute');
      }
      return;
    }

    const nextMinute = angleToStep(pointer.angle, 60);
    setDraftMinute(nextMinute);
    if (finalize) {
      applyTime(draftHour, nextMinute);
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      updateFromPointer(event, false);
    };

    const handleUp = (event: PointerEvent) => {
      updateFromPointer(event, true);
      setIsDragging(false);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);

    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [isDragging, mode, draftHour]);

  const handleDialPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    setIsDragging(true);
    updateFromPointer(event, false);
  };

  const hourInnerNodes = INNER_HOUR_VALUES.map((hour, index) => {
    const point = toPoint(index, INNER_HOUR_VALUES.length, INNER_RADIUS);
    const isSelected = draftHour === hour;

    return (
      <span
        key={`hour-inner-${hour}`}
        className="absolute -translate-x-1/2 -translate-y-1/2 text-sm font-medium select-none pointer-events-none"
        style={{
          left: `${point.x}px`,
          top: `${point.y}px`,
          color: isSelected ? 'var(--primary)' : 'var(--foreground)',
          transform: 'translate(-50%, -50%) scale(1)',
          textShadow: isSelected ? '0 0 10px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
        }}
      >
        {hour}
      </span>
    );
  });

  const hourOuterNodes = OUTER_HOUR_VALUES.map((hour, index) => {
    const point = toPoint(index, OUTER_HOUR_VALUES.length, OUTER_RADIUS);
    const isSelected = draftHour === hour;

    return (
      <span
        key={`hour-outer-${hour}`}
        className="absolute -translate-x-1/2 -translate-y-1/2 text-sm font-semibold select-none pointer-events-none"
        style={{
          left: `${point.x}px`,
          top: `${point.y}px`,
          color: isSelected ? 'var(--primary)' : 'var(--foreground)',
          textShadow: isSelected ? '0 0 10px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
        }}
      >
        {hour}
      </span>
    );
  });

  const minuteNodes = MINUTE_LABEL_VALUES.map((minute, index) => {
    const point = toPoint(index, MINUTE_LABEL_VALUES.length, MINUTE_RADIUS);
    const isSelected = Math.round(draftMinute / 5) * 5 % 60 === minute;

    return (
      <span
        key={`minute-${minute}`}
        className="absolute -translate-x-1/2 -translate-y-1/2 text-sm font-medium select-none pointer-events-none"
        style={{
          left: `${point.x}px`,
          top: `${point.y}px`,
          color: isSelected ? 'var(--primary)' : 'var(--foreground)',
          textShadow: isSelected ? '0 0 10px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
        }}
      >
        {pad2(minute)}
      </span>
    );
  });

  return (
    <div className="relative" ref={pickerRef}>
      {!hideLabel && (
        <label htmlFor={id} className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => {
          setMode('hour');
          setIsOpen((previous) => !previous);
        }}
        className="w-full px-3 py-2 border rounded-md shadow-sm text-left disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          backgroundColor: 'var(--background)',
          borderColor: 'var(--border)',
          color: 'var(--foreground)',
        }}
      >
        {displayText}
      </button>

      {isOpen && (
        <div
          className="absolute z-20 mt-2 rounded-lg border p-3 shadow-xl"
          style={{
            backgroundColor: 'var(--secondary)',
            borderColor: 'var(--border)',
            width: '300px',
          }}
        >
          <div
            className="rounded-md p-3 mb-3"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
            }}
          >
            <div className="text-xs uppercase tracking-wide opacity-90">{label}</div>
            <div className="mt-1 flex items-center gap-2 text-3xl font-bold leading-none">
              <button
                type="button"
                onClick={() => setMode('hour')}
                className="rounded px-1"
                style={{
                  backgroundColor: mode === 'hour' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                {pad2(draftHour)}
              </button>
              <span>:</span>
              <button
                type="button"
                onClick={() => setMode('minute')}
                className="rounded px-1"
                style={{
                  backgroundColor: mode === 'minute' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                {pad2(draftMinute)}
              </button>
            </div>
            <div className="mt-1 text-xs opacity-90">{toLabel12(`${pad2(draftHour)}:${pad2(draftMinute)}`)}</div>
          </div>

          <div
            ref={dialRef}
            className="relative w-[264px] h-[264px] mx-auto touch-none cursor-crosshair"
            onPointerDown={handleDialPointerDown}
            role="group"
            aria-label={`${label} clock picker`}
          >
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: '244px',
                height: '244px',
                border: '1px solid var(--border)',
                backgroundColor: 'color-mix(in srgb, var(--background) 92%, var(--primary) 8%)',
              }}
            />
            {mode === 'hour' ? (
              <>
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: '172px',
                    height: '172px',
                    border: '1px dashed color-mix(in srgb, var(--border) 55%, transparent)',
                  }}
                />
                {hourOuterNodes}
                {hourInnerNodes}
              </>
            ) : (
              minuteNodes
            )}

            <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
              <line
                x1={DIAL_CENTER}
                y1={DIAL_CENTER}
                x2={pointerPoint.x}
                y2={pointerPoint.y}
                stroke="var(--primary)"
                strokeWidth={3}
                strokeLinecap="round"
              />
            </svg>

            <div
              className="absolute rounded-full"
              style={{
                width: '14px',
                height: '14px',
                backgroundColor: 'var(--primary)',
                left: `${pointerPoint.x - 7}px`,
                top: `${pointerPoint.y - 7}px`,
                boxShadow: '0 0 0 4px color-mix(in srgb, var(--primary) 22%, transparent)',
              }}
            />

            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full text-xs font-semibold flex items-center justify-center"
              style={{
                width: '14px',
                height: '14px',
                backgroundColor: 'var(--primary)',
              }}
            />
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--muted-foreground)' }}>
            Click or drag anywhere on the dial. Inner ring selects 0-11, outer ring selects 12-23.
          </p>
        </div>
      )}
    </div>
  );
}
