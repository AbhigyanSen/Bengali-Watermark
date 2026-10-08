"""West Bengal traditional solar Bangabda, using checked Kolkata month starts.

The data below records start dates from the Prokerala Bengali Calendar annual
pages for 2025 and 2026 (Bisuddha Siddhanta / Kolkata). The Bangladesh revised
calendar is deliberately NEVER used.

Limited, explicit range: 2025-01-01 through 2026-12-31. Extend the table only
after verifying new years against authoritative Kolkata monthly calendars.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import date

MONTH_NAMES = (
    "বৈশাখ", "জ্যৈষ্ঠ", "আষাঢ়", "শ্রাবণ", "ভাদ্র", "আশ্বিন",
    "কার্তিক", "অগ্রহায়ণ", "পৌষ", "মাঘ", "ফাল্গুন", "চৈত্র",
)

# (Gregorian date when the month begins, Bengali month 0-11, Bangabda year)
# https://www.prokerala.com/calendar/bengalicalendar-2025.html
# https://www.prokerala.com/calendar/bengalicalendar-2026.html
_BOUNDARIES = (
    (date(2024, 12, 17), 8, 1431),
    (date(2025, 1, 15), 9, 1431),
    (date(2025, 2, 14), 10, 1431),
    (date(2025, 3, 15), 11, 1431),
    (date(2025, 4, 15), 0, 1432),
    (date(2025, 5, 16), 1, 1432),
    (date(2025, 6, 16), 2, 1432),
    (date(2025, 7, 18), 3, 1432),
    (date(2025, 8, 18), 4, 1432),
    (date(2025, 9, 18), 5, 1432),
    (date(2025, 10, 19), 6, 1432),
    (date(2025, 11, 18), 7, 1432),
    (date(2025, 12, 17), 8, 1432),
    (date(2026, 1, 15), 9, 1432),
    (date(2026, 2, 14), 10, 1432),
    (date(2026, 3, 16), 11, 1432),
    (date(2026, 4, 15), 0, 1433),
    (date(2026, 5, 16), 1, 1433),
    (date(2026, 6, 16), 2, 1433),
    (date(2026, 7, 18), 3, 1433),
    (date(2026, 8, 19), 4, 1433),
    (date(2026, 9, 19), 5, 1433),
    (date(2026, 10, 19), 6, 1433),
    (date(2026, 11, 18), 7, 1433),
    (date(2026, 12, 17), 8, 1433),
)
_FIRST = date(2025, 1, 1)
_LAST = date(2026, 12, 31)
_STARTS = tuple(row[0] for row in _BOUNDARIES)


class CalendarRangeError(ValueError):
    """The given Gregorian date has no checked local Panjika conversion."""


@dataclass(frozen=True)
class BengaliDate:
    day: int
    month: int  # 0-based month index
    year: int
    name: str


def to_west_bengal_date(day: date) -> BengaliDate:
    if not _FIRST <= day <= _LAST:
        raise CalendarRangeError(
            "West Bengal Panjika is verified for 2025–2026 only. "
            "Choose Bengali Gregorian for other dates until more years are validated."
        )
    index = bisect_right(_STARTS, day) - 1
    start, month, year = _BOUNDARIES[index]
    return BengaliDate(day=(day - start).days + 1, month=month, year=year, name=MONTH_NAMES[month])
