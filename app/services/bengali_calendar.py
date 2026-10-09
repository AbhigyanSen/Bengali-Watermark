"""West Bengal traditional solar Bangabda month-start conversion.

Supported Gregorian date range: 2025-01-01 to 2029-12-31.
Uses Kolkata Bisuddha Siddhanta / Drik month-start boundaries.
The additional 2027-2029 data needs independent full-month verification.
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
# Existing 2025–2026 boundaries were sourced from Prokerala Kolkata calendars:
# https://www.prokerala.com/calendar/bengalicalendar-2025.html
# https://www.prokerala.com/calendar/bengalicalendar-2026.html
# The supplied 2027–2029 entries require an independent month-by-month source audit.
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
    (date(2027, 1, 15), 9, 1433),
    (date(2027, 2, 14), 10, 1433),
    (date(2027, 3, 16), 11, 1433),
    # 1434
    (date(2027, 4, 15), 0, 1434),  # corrected from supplied Apr 16
    (date(2027, 5, 16), 1, 1434),
    (date(2027, 6, 17), 2, 1434),
    (date(2027, 7, 18), 3, 1434),
    (date(2027, 8, 19), 4, 1434),
    (date(2027, 9, 19), 5, 1434),
    (date(2027, 10, 19), 6, 1434),
    (date(2027, 11, 18), 7, 1434),
    (date(2027, 12, 17), 8, 1434),
    (date(2028, 1, 16), 9, 1434),
    (date(2028, 2, 15), 10, 1434),
    (date(2028, 3, 15), 11, 1434),
    # 1435
    (date(2028, 4, 14), 0, 1435),  # corrected from supplied Apr 15, Drik calendar
    (date(2028, 5, 15), 1, 1435),
    (date(2028, 6, 16), 2, 1435),
    (date(2028, 7, 17), 3, 1435),
    (date(2028, 8, 18), 4, 1435),
    (date(2028, 9, 18), 5, 1435),
    (date(2028, 10, 18), 6, 1435),
    (date(2028, 11, 17), 7, 1435),
    (date(2028, 12, 16), 8, 1435),
    (date(2029, 1, 15), 9, 1435),
    (date(2029, 2, 13), 10, 1435),
    (date(2029, 3, 15), 11, 1435),
    # 1436
    (date(2029, 4, 15), 0, 1436),
    (date(2029, 5, 16), 1, 1436),
    (date(2029, 6, 16), 2, 1436),
    (date(2029, 7, 18), 3, 1436),
    (date(2029, 8, 18), 4, 1436),
    (date(2029, 9, 18), 5, 1436),
    (date(2029, 10, 19), 6, 1436),
    (date(2029, 11, 18), 7, 1436),
    (date(2029, 12, 17), 8, 1436),
)
_FIRST = date(2025, 1, 1)
_LAST = date(2029, 12, 31)
_STARTS = tuple(row[0] for row in _BOUNDARIES)


class CalendarRangeError(ValueError):
    """The Gregorian date lies outside the supported Panjika table."""


@dataclass(frozen=True)
class BengaliDate:
    day: int
    month: int  # 0-based month index
    year: int
    name: str


def to_west_bengal_date(day: date) -> BengaliDate:
    if not _FIRST <= day <= _LAST:
        raise CalendarRangeError(
            "West Bengal Panjika is available for 2025–2029 only. "
            "Choose Bengali Gregorian for other dates."
        )
    index = bisect_right(_STARTS, day) - 1
    start, month, year = _BOUNDARIES[index]
    return BengaliDate(day=(day - start).days + 1, month=month, year=year, name=MONTH_NAMES[month])
