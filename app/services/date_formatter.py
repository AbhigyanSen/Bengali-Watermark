"""One authoritative formatter for preview endpoint and final image engine."""
from datetime import datetime
from app.services.bengali_calendar import to_west_bengal_date

EN_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
BN_GREGORIAN_MONTHS = ("জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর")
DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def bn_digits(value: object) -> str:
    return str(value).translate(DIGITS)


def day_period(hour: int) -> str:
    if 4 <= hour < 6:
        return "ভোর"
    if 6 <= hour < 12:
        return "সকাল"
    if 12 <= hour < 15:
        return "দুপুর"
    if 15 <= hour < 18:
        return "বিকেল"
    if 18 <= hour < 20:
        return "সন্ধ্যা"
    return "রাত"


def parse_camera_datetime(value: str) -> datetime:
    # Strict camera wall-clock fields: do not convert to Render/server timezone.
    try:
        result = datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except (TypeError, ValueError) as exc:
        raise ValueError("Date/time must be YYYY-MM-DDTHH:MM, using the camera's local clock time.") from exc
    if result.strftime("%Y-%m-%dT%H:%M") != value:
        raise ValueError("Invalid photo date/time.")
    return result


def format_timestamp(moment: datetime, language: str, calendar: str) -> str:
    if language not in {"en", "bn"}:
        raise ValueError("Language must be en or bn.")
    if calendar not in {"gregorian", "panjika"}:
        raise ValueError("Calendar must be gregorian or panjika.")
    if language == "en" and calendar == "panjika":
        raise ValueError("Select Bengali language to use the West Bengal Panjika.")
    h12 = moment.hour % 12 or 12
    if language == "en":
        am_pm = "AM" if moment.hour < 12 else "PM"
        return f"{EN_MONTHS[moment.month - 1]} {moment.day:02}, {moment.year} · {h12}:{moment.minute:02} {am_pm}"
    if calendar == "gregorian":
        return f"{bn_digits(moment.day)} {BN_GREGORIAN_MONTHS[moment.month - 1]}, {bn_digits(moment.year)} · {bn_digits(f'{moment.hour:02}:{moment.minute:02}')}"
    converted = to_west_bengal_date(moment.date())
    return f"{bn_digits(converted.day)} {converted.name}, {bn_digits(converted.year)} · {day_period(moment.hour)} {bn_digits(h12)}:{bn_digits(f'{moment.minute:02}')}"
