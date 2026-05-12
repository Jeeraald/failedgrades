import { useState } from "react";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  value: Date;
  onChange: (d: Date) => void;
}

export default function MiniCalendar({ value, onChange }: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [cursor, setCursor] = useState(() => {
    const d = new Date(value);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const year  = cursor.getFullYear();
  const month = cursor.getMonth();

  const prevMonth = () => setCursor(new Date(year, month - 1, 1));
  const nextMonth = () => setCursor(new Date(year, month + 1, 1));
  const goToday   = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    setCursor(d);
    onChange(new Date());
  };

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  const cells: { date: Date; current: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), current: false });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), current: true });
  while (cells.length < 42)
    cells.push({ date: new Date(year, month + 1, cells.length - daysInMonth - firstDay + 1), current: false });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();

  const selectedNorm = new Date(value);
  selectedNorm.setHours(0, 0, 0, 0);

  return (
    // Fixed 288 × 288 px — naturally 4 × 4 in at 72 DPI, ≈ 3 in at 96 DPI
    // Cell math: 7 cols × 36 px = 252 px + 6 px gaps = 258 px content, padded to 288 px
    <div className="w-[288px] mx-auto select-none">

      {/* Header — 36 px tall */}
      <div className="flex items-center justify-between h-9 mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="Previous month"
        >
          <i className="pi pi-chevron-left text-sm"></i>
        </button>

        <button
          type="button"
          onClick={goToday}
          title="Go to today"
          className="text-sm font-bold text-gray-800 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          {MONTHS[month]} {year}
        </button>

        <button
          type="button"
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="Next month"
        >
          <i className="pi pi-chevron-right text-sm"></i>
        </button>
      </div>

      {/* Day-of-week labels — 24 px tall */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d) => (
          <div
            key={d}
            className="h-6 flex items-center justify-center text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — 6 rows × 32 px = 192 px */}
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map(({ date, current }, i) => {
          const isToday    = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedNorm);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(new Date(date))}
              className={`
                h-8 flex items-center justify-center rounded-lg text-sm font-semibold transition-colors
                ${isSelected
                  ? "bg-blue-600 text-white shadow-sm"
                  : isToday
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-400/40"
                  : current
                  ? "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  : "text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                }
              `}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {/* Today shortcut */}
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={goToday}
          className="text-xs font-semibold text-blue-500 dark:text-blue-400 hover:underline underline-offset-2 transition-colors"
        >
          Today
        </button>
      </div>
    </div>
  );
}
